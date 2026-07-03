# Executeurs de noeuds et fan-out multi-cibles

Le comportement de chaque type de noeud du graphe v2 est defini dans la map `EXECUTORS` de `server/src/services/scenarioGraph.service.ts` (lignes 579-881) ; cette page detaille le comportement de chaque famille de noeuds et le mecanisme de fan-out vers plusieurs devices.

## La map EXECUTORS

La map `EXECUTORS` associe chaque type de noeud (`ScenarioNodeType`) a sa fonction d'execution (`server/src/services/scenarioGraph.service.ts`, lignes 579-881).

### Triggers â€” no-op passifs

Les 11 types `trigger_*` sont tous des no-op au moment de l'execution â€” ils ne servent qu'a determiner le point d'entree du graphe et a filtrer le declenchement en amont (voir page "Declenchement des scenarios") :

```ts
'trigger_xxx': async () => ({ exitCode: null })
```

### `cooldown` (lignes 602-634)

Verifie/ecrit la table `scenario_cooldown_state`, keyee par le triplet `(scenario_id, device_id, node_id)`.

- Si le run est dans la fenetre de cooldown : termine le run en `'success'` avec `exitCode: -1` et un message stdout `"cooldown active (...)"`.
- Sinon : horodate `last_pass_at` et laisse passer avec `exitCode: 0`.

Consequence de la cle composite : plusieurs noeuds `cooldown` dans un meme scenario ont des fenetres independantes, et plusieurs triggers qui convergent vers le meme noeud `cooldown` partagent la meme fenetre.

### `run_script` (lignes 642-696)

1. Resout la ligne `scripts` correspondante.
2. Calcule les devices cibles via `resolveActionTargets()` / `validateTargetsInTenant()`.
3. Enqueue une commande (`commandService.enqueue`, type `run_script`, `sourceType: 'scenario_node'`, `sourceId: nodeRunId`) **par device cible**.
4. Si plus d'une cible, enregistre une entree dans `pendingFanOuts`.
5. Retourne `{ awaitsAck: true }` â€” le noeud reste en attente jusqu'a reception du ou des ACK(s) agent.

### `run_command` (lignes 768-793)

Meme pattern de fan-out que `run_script`, mais pour des commandes agent typees (hors script).

### `send_notification` (lignes 709-737)

Synchrone â€” dispatch immediat via `automationNotificationService`, pas d'attente d'ACK.

### `wait` (lignes 742-754)

Parque l'execution via `setTimeout`, puis rappelle `handleNodeCommandAck` a l'expiration du delai. C'est ce noeud que `rearmWaitTimersOnBoot()` doit reprendre apres un redemarrage serveur.

### `tag_device` (lignes 801-826) et `move_device_to_group` (lignes 831-845)

Mutations DB synchrones, respectant le meme mecanisme de fan-out `targetMode` / `targetDeviceIds` que les actions ci-dessus.

### `branch_exit_code` (lignes 759-761)

Fait simplement transiter `run.last_exit_code` vers la selection d'edge (`pickNextEdge`).

### `branch_on_device` (lignes 852-870)

Compare un champ du device (`os_type`, `group`, `status`, `tag`) a `config.value`. Retourne `exitCode: 0` en cas de match, `1` sinon.

### `end_success` / `end_failure` (lignes 873-880)

Retournent `{ terminate: 'success' | 'failure', errorMessage }`, ce qui cloture le run.

## Fan-out multi-cibles

Les actions `run_script`, `run_command`, `tag_device` et `move_device_to_group` supportent toutes le meme mecanisme de ciblage multi-device, implemente dans `server/src/services/scenarioGraph.service.ts` (lignes 73-119) :

### Resolution des cibles

`resolveActionTargets()` lit `config.targetMode === 'devices'` + `config.targetDeviceIds`. Si la liste est vide apres filtrage, elle retombe sur `run.device_id` (le device qui a declenche le run).

### Validation tenant + privacy mode

`validateTargetsInTenant()` :
- Retire les devices hors tenant.
- Retire les devices en `privacy_mode_enabled`, **sauf** si `scenario.bypass_privacy_mode === true`.

### Agregation des resultats (`pendingFanOuts`)

`pendingFanOuts` est une map en memoire qui suit, par `nodeRunId`, le nombre d'ACKs attendus vs recus. Regle d'agregation : **"worst exit wins"** â€” le code de sortie final retenu est le maximum des codes de sortie individuels ; les `stdout`/`stderr` de chaque device sont concatenes avec un separateur `--- device boundary ---`.

Limite connue (commentaire lignes 68-72 du fichier) : cet etat de fan-out est **en memoire** â€” c'est une limitation MVP acceptee. Elle n'est **pas** couverte par le janitor de boot (`rearmWaitTimersOnBoot` ne traite que les noeuds `wait`), donc un redemarrage serveur en plein milieu d'un fan-out laisse le noeud bloque en `'running'` indefiniment.

## Endpoint de test dans l'editeur

`POST /api/scenarios/:id/start-graph-run` (`server/src/routes/scenario.routes.ts`, lignes 572-677) permet de lancer un run de test directement depuis l'editeur graphique, avec plusieurs modes d'entree :

| Parametre | Effet |
|---|---|
| `deviceIds[]` / `deviceId` | Device(s) cible(s) du run de test |
| `triggerNodeId` | Demarre depuis un trigger specifique (walk normal) |
| `startNodeId` | Entree en milieu de graphe â€” saute le walk depuis le trigger |
| `singleNode` | S'arrete apres un seul noeud, encode via un marqueur `\|__single_node` dans `trigger_source`, lu par `scenarioGraphService._advance` (lignes 541-547) |

Le `status` du scenario (`draft`, `disabled`, etc.) n'est volontairement **pas** verifie sur cet endpoint â€” un admin peut ainsi tester un scenario encore en brouillon ou desactive.