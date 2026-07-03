# Export / import JSON portable et ajout d'un node type

Le format JSON portable des scenarios sert a briefer un LLM pour generer un scenario, migrer un scenario entre tenants ou installs, et sauvegarder un scenario complexe avant un refacto risque.

## Endpoints serveur

Tous dans `server/src/routes/scenario.routes.ts` :

| Endpoint | Ligne | Role |
|---|---|---|
| `GET /api/scenarios/dummy-export` | 78-83 | Squelette commente complet, un exemple par type de noeud |
| `GET /api/scenarios/:id/export?includeScripts=1` | 290-297 | Export d'un scenario (lean, ou avec scripts embarques) |
| `POST /api/scenarios/import` | 253-273 | Import two-pass (preview de conflits puis commit) |
| `GET /api/scenarios/export-all` | 15-34 | Export en masse, tous les scenarios |
| `POST /api/scenarios/import-bulk` | 39-72 | Import en masse |

**Attention versioning** : `export-all` enveloppe le resultat dans un objet dont le champ racine `formatVersion` est **toujours fige a `1`** (ligne 26) â€” un numero de version totalement distinct du `formatVersion: 2` porte par chaque scenario individuel dans le tableau `scenarios[]`. Les deux compteurs ne doivent pas etre confondus lors de la lecture d'un export en masse.

## Forme du payload (`formatVersion: 2`)

Produit par `exportScenario()` et consomme par `importScenario()`, tous deux dans `server/src/services/scenario.service.ts` :

```json
{
  "formatVersion": 2,
  "exportedAt": "...",
  "scenario": { /* metadata â€” le champ status est intentionnellement omis */ },
  "nodes": [
    {
      "clientId": "<uuid>",
      "type": "run_script",
      "label": "...",
      "config": { /* ... */ },
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
  "scripts": [ /* uuid, name, content, params â€” seulement si includeScripts=1, sinon null */ ],
  "schedules": [ /* seulement si des schedules referencent ce scenario, sinon null */ ]
}
```

`schedules` embarque les `script_schedules` lies via `on_failure_scenario_id`, ou via `config.scheduleId` d'un noeud `trigger_schedule_*`.

## `exportScenario()`

`server/src/services/scenario.service.ts`, lignes 456-621. Retourne le payload ci-dessus. Le `clientId` de chaque noeud est l'uuid du noeud (pas son id numerique DB) â€” c'est cette valeur qui est reutilisee dans `edges[].sourceNodeClientId` / `targetNodeClientId` pour reconstituer le graphe a l'import, independamment des ids DB de l'install cible.

## `importScenario()`

`server/src/services/scenario.service.ts`, lignes 635-978. Signature :

```ts
importScenario(tenantId, payload, { commit, conflictResolutions, userId })
```

### Compatibilite de version

`formatVersion` 1 ou 2 accepte en entree (lignes 656-661). Un payload v1 est auto-converti via `migrateV1ToV2()` (lignes 2281-2330), qui injecte un noeud `cooldown` en aval de chaque trigger qui portait un `config.cooldownSeconds` non nul.

### Validation structurelle (lignes 679-759)

Toutes les erreurs sont collectees et levees en une seule `Error` multi-lignes :

- Unicite des `clientId`.
- Types de noeuds connus, verifies contre le `Set VALID_NODE_TYPES` (lignes 679-688).
- Les noeuds `run_script` doivent porter `scriptId` ou `scriptUuid`.
- Les edges doivent referencer des `clientId` valides.
- Les scripts embarques doivent avoir `uuid` + `name` + `content`.

### Two-pass preview / commit

- **Sans `conflictResolutions`** (`commit: false`) : retourne un objet `{ kind: 'preview', conflicts: [{ scriptUuid, existingScriptId, existingName, importedName }] }` pour chaque script embarque dont l'`uuid` entre en collision avec un script deja existant dans le tenant.
- **Avec `commit: true`** : execute l'insertion complete (scripts selon la resolution `skip` / `overwrite` / `new`, scenario force au statut `draft`, noeuds avec table de correspondance `clientId â†’ id`, edges, schedules) **dans une seule transaction Knex** (`db.transaction`).

## `getDummyExportTemplate()`

`server/src/services/scenario.service.ts`, lignes 984-1297. Squelette JSON statique (aucun acces DB), fortement commente, demontrant :

- Un noeud par type de `ScenarioNodeType`.
- Les 5 formes de `ScenarioEdgeCondition`.
- Un script embarque et un schedule embarque en exemple.

Sert de reference canonique pour un LLM qui doit generer un scenario a partir d'un brief en langage naturel â€” c'est la raison pour laquelle **tout nouveau node type doit imperativement y etre ajoute** (voir checklist ci-dessous).

## Checklist : ajouter un nouveau type de noeud

Cinq endroits a toucher, sans quoi le node passe le ts-check mais explose au runtime (aucune validation automatique ne detecte un oubli) :

1. **`shared/src/types.ts`** â€” ajouter le type au type union `ScenarioNodeType` (et a `ScenarioTriggerType` s'il s'agit d'un trigger).
2. **`server/src/services/scenarioGraph.service.ts`** â€” ajouter une entree dans la map `EXECUTORS`. Pour un trigger passif : `'trigger_xxx': async () => ({ exitCode: null })`. Pour une action, implementer la logique d'execution reelle.
3. **`server/src/services/scenario.service.ts`**, fonction `importScenario` â€” ajouter le type au `Set VALID_NODE_TYPES`, sinon l'import rejette toute entree de ce type avec "unknown node type". C'est une liste dupliquee **manuellement** du type partage `ScenarioNodeType` â€” point de synchronisation manuel, source potentielle de divergence en cas d'oubli.
4. **`server/src/services/scenario.service.ts`**, fonction `getDummyExportTemplate()` â€” ajouter un noeud de demonstration avec un `_comment` decrivant son role, ses champs `config` et des valeurs d'exemple. Sans cette etape, un LLM generant un export ne saura pas utiliser ce node type.
5. **`client/src/components/scenarios/scenarioNodeRegistry.ts`** â€” ajouter une entree dans le tableau `NODE_TYPES` (interface `NodeTypeMeta`, lignes 34-49) avec `category` / `accent` / `hint` / `defaultConfig` / `fields[]`. C'est ce qui pilote la palette de l'editeur, le formulaire de config et le rendu sur le canvas.

Pour un trigger declenche par un evenement (push, cron, etc.), ajouter en plus :

- L'appel `fireTrigger` dans le code emetteur concerne (ex. `device.service.ts` pour les triggers `metric_*`).
- Le filtre de routage correspondant dans `scenario.service.ts`, fonction `fireTrigger` (voir page "Declenchement des scenarios").

## Bump du `formatVersion`

Si la shape change (rename de champ, suppression, restructuration profonde), le `formatVersion` (actuellement `2`) doit etre bumpe a trois endroits :

- La valeur retournee par `getDummyExportTemplate()`.
- La valeur retournee par `exportScenario()`.
- La branche de lecture de `importScenario()` doit soit migrer la version precedente vers la nouvelle (cf. `migrateV1ToV2()` comme modele), soit retourner une erreur claire du type "Re-export from a vN-aware install".

**Regle absolue** : ne jamais changer la shape silencieusement sans bumper le `formatVersion` â€” les exports JSON archives par les admins doivent rester importables indefiniment, sous peine de casser leurs sauvegardes.

## Table `scenario_cooldown_state` et migration v1 â†’ v2 du cooldown

`server/src/db/migrations/087_scenario_cooldown_node.ts` cree la table `scenario_cooldown_state` (`scenario_id`, `device_id`, `node_id`, `last_pass_at`, contrainte unique sur le triplet) et, dans le meme `up()`, migre en base tout noeud trigger pre-existant dont `config.cooldownSeconds > 0` en inserant un noeud `cooldown` en aval et en re-cablant les edges. Cette transformation est le pendant DB de `migrateV1ToV2()` cote import JSON â€” les deux implementent la meme logique de conversion, l'une sur des lignes existantes en base, l'autre sur un payload JSON entrant.