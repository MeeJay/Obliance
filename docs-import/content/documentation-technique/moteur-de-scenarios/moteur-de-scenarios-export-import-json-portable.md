Le format JSON portable des scenarios permet de generer un scenario via un LLM, de le migrer entre tenants/installations, ou de le sauvegarder avant un refacto risque.

## Endpoints

Definis dans `server/src/routes/scenario.routes.ts` :

| Methode | Route | Ligne | Description |
|---|---|---|---|
| GET | `/api/scenarios/dummy-export` | 78 | Squelette commente complet, un exemple par type de noeud |
| GET | `/api/scenarios/:id/export` | 290 | Export d'un scenario (`?includeScripts=1` pour embarquer les scripts) |
| POST | `/api/scenarios/import` | 253 | Import two-pass, protege par `requireTenantCapability('scripts.manage')` |
| GET | `/api/scenarios/export-all` | 15 | Export en masse de tous les scenarios du tenant |
| POST | `/api/scenarios/import-bulk` | 39 | Import en masse |
| GET | `/api/scenarios/templates` | 86 | Liste des templates pre-integres |
| POST | `/api/scenarios/templates/:index/instantiate` | 102 | Instancie un template en scenario reel |

## Forme du payload

```json
{
  "formatVersion": 2,
  "exportedAt": "2026-...",
  "scenario": { "name": "...", "description": "..." },
  "nodes": [
    {
      "clientId": "<uuid-stable>",
      "type": "run_script",
      "label": "...",
      "config": { "...": "..." },
      "positionX": 0,
      "positionY": 0
    }
  ],
  "edges": [
    {
      "sourceNodeClientId": "<uuid>",
      "sourceHandle": "...",
      "targetNodeClientId": "<uuid>",
      "condition": { "kind": "exit_code_eq", "value": 0 },
      "sortOrder": 0
    }
  ],
  "scripts": [ { "uuid": "...", "content": "..." } ] ,
  "schedules": [ { "uuid": "...", "scriptUuid": "..." } ]
}
```

`scripts` et `schedules` valent `null` si `includeScripts` n'est pas demande a l'export.

### Status omis a l'export

Le statut du scenario est **intentionnellement omis** a l'export (`exportScenario()`, `scenario.service.ts` lignes 456-621, commentaire lignes 595-597) : un scenario importe atterrit toujours en statut `draft`, pour eviter qu'il se declenche automatiquement avant revue par un admin.

## Fonctions cles (`scenario.service.ts`)

### `exportScenario()` â€” lignes 456-621

`formatVersion` actuel : **2** (ligne 578).

### `getDummyExportTemplate()` â€” ligne 984

Retourne le squelette commente utilise par `GET /dummy-export`, avec `formatVersion: 2` (ligne 990) et un exemple de noeud par type â€” reference utilisee par un LLM pour generer un scenario valide.

**A verifier avant diffusion large** : la couverture exhaustive (un exemple par `ScenarioNodeType` sans exception) n'a pas ete auditee ligne par ligne. C'est pourtant une exigence explicite de la checklist "ajouter un node type" du CLAUDE.md racine â€” a controler lors du prochain ajout de type de noeud.

### `importScenario()` â€” lignes 635-761+

Processus **two-pass** :

1. `commit: false` (ou absent) â†’ retourne la liste des conflits detectes (scripts dont l'`uuid` existe deja dans le tenant cible), avec options de resolution `skip` / `overwrite` / `new`
2. `commit: true` + `conflictResolutions` â†’ ecrit `scenario` + `nodes` + `edges` + `scripts` + `schedules` dans **une transaction unique**

Validation structurelle stricte :
- `clientId` requis et unique par noeud
- `VALID_NODE_TYPES` (Set, ligne 679-688) â€” rejette tout type de noeud inconnu avec un message listant les types valides
- Les cles `_comment` (aide documentaire du dummy-export) sont strippees silencieusement, ce ne sont pas des champs reels du modele

## Versions du format

La version est validee des l'entree de l'import (`scenario.service.ts`, lignes 656-658) : seules les valeurs `1` et `2` sont acceptees, toute autre valeur fait echouer l'import avec une erreur explicite (`Unsupported export format version`). Un payload en version `1` est automatiquement converti vers la version `2` via `migrateV1ToV2()` avant d'etre traite plus loin dans le pipeline d'import.

| Version | Statut | Particularite |
|---|---|---|
| 1 | deprecated, accepte en lecture seule | Le cooldown vivait sur les triggers via `config.cooldownSeconds` |
| 2 | courant | Le cooldown est un noeud a part entiere (`type: 'cooldown'`) |

`migrateV1ToV2()` (`scenario.service.ts` ligne 2281) convertit un payload v1 a la volee au moment de l'import : un noeud `type: 'cooldown'` est injecte entre chaque trigger portant un `cooldownSeconds > 0` et ses cibles en aval.

### Bump du formatVersion â€” regle absolue

Toute modification de la shape du payload (rename de champ, suppression, restructuration profonde) impose de **bumper `formatVersion`** dans 3 endroits :

1. `getDummyExportTemplate()` â€” la valeur retournee
2. `exportScenario()` â€” la valeur retournee
3. `importScenario()` â€” ajouter la branche de migration vers la nouvelle version (helper dedie, sur le modele de `migrateV1ToV2`), ou lever une erreur claire type `Re-export from a vN-aware install`

Ne **jamais** changer la shape silencieusement sans bumper : les exports JSON archives par les admins doivent rester importables indefiniment, sous peine de casser leurs backups.

## Templates pre-integres â€” structure legacy

`server/src/services/scenario-templates/index.ts` definit 12 `ScenarioTemplate`, mais leur structure interne est encore l'**ancien modele lineaire v1** : chaque template expose une liste `steps: ScenarioTemplateStep[]` (lignes 13-20), ou chaque step porte les champs `checkScript`, `resolveScript`, `timeoutSeconds` et `retryCount`.

`POST /api/scenarios/templates/:index/instantiate` (`scenario.routes.ts` lignes 102-186) :

1. Cree les scripts check + resolve en DB
2. Cree un scenario v1 avec `steps` via `scenarioService.create()`
3. Appelle immediatement `migrateScenarioToV2()` (`server/src/services/scenarioMigrate.service.ts`) dans un `try/catch` silencieux, pour convertir le scenario fraichement cree vers le modele graphe v2

Resultat : l'editeur React Flow s'ouvre toujours sur un graphe, meme pour un template historiquement ecrit en check/resolve.

### Sanitisation des variables de template

A l'instantiation, whitelist stricte des cles connues (`template.variables`), rejet des valeurs non-string et des caracteres de controle/NUL (`scenario.routes.ts` lignes 110-124) â€” protection anti-injection dans le contenu des scripts generes.