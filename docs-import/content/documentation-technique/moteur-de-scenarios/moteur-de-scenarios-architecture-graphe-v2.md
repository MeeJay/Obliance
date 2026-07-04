Le moteur d'execution des scenarios Obliance est un **graph engine** (v2) qui a remplace l'ancienne state machine lineaire check→resolve→recheck (v1).

## Deux modeles coexistent dans le code

| Modele | Fichier | Structure | Statut |
|---|---|---|---|
| v1 (legacy) | `server/src/services/scenario.service.ts` | `ScenarioStep[]` avec `check`/`resolve` | En cours de retrait |
| v2 (courant) | `server/src/services/scenarioGraph.service.ts` | `scenario_nodes` + `scenario_edges` (graphe) | Chemin d'execution actif |

Le commentaire d'en-tete de `scenarioGraph.service.ts` (lignes 10-19) indique explicitement que ce fichier remplace *"the legacy linear engine in scenario.service.ts"* et que `scenario.service.ts` sera retire une fois la migration automatique **Phase 1B** terminee pour tous les tenants. Le code source ne contient a ce jour que cette mention en commentaire — l'execution effective de cette migration (job planifie, script dedie, etc.) n'a pas ete identifiee ailleurs dans le codebase. A confirmer aupres de l'equipe backend avant de considerer cette migration comme terminee ou automatique pour l'ensemble des tenants existants.

Le CLAUDE.md racine du projet decrit uniquement le flow check→resolve→recheck comme *"Flow d'une etape"*. En realite ce flow correspond au modele v1 (deprecated) : dans le graphe v2, il n'y a pas de notion native de check/resolve — c'est a l'admin de construire manuellement un pattern equivalent avec des noeuds `run_script` (check) → `branch_exit_code` → `run_script` (resolve) → re-check.

## Modele de donnees v1 (legacy)

Le type `ScenarioStepRunStatus` (`shared/src/types.ts` ligne 1901) porte encore la state machine historique :

```ts
type ScenarioStepRunStatus =
  | 'pending'
  | 'check_running'
  | 'check_passed'
  | 'resolve_running'
  | 'recheck_running'
  | 'recheck_passed'
  | 'failed'
  | 'skipped'
  | 'success';
```

## Modele de donnees v2 (graphe)

Les steps sont remplaces par des noeuds relies par des aretes conditionnelles :

- Table `scenarios` — metadata du scenario
- Table `scenario_nodes` — un noeud typé (`type`, `config`, position sur le canvas)
- Table `scenario_edges` — une arete `sourceNodeId → targetNodeId` avec une `condition`
- Table `scenario_runs` — une execution d'un scenario sur un device
- Table `scenario_node_runs` — l'execution d'un noeud dans un run donne
- Table `scenario_cooldown_state` (migration `087`) — etat de pacing des noeuds `cooldown`

### Conditions d'arete

`ScenarioEdgeCondition` (`shared/src/types.ts` lignes 1960-1965) est une union discriminee :

```ts
type ScenarioEdgeCondition =
  | { kind: 'always' }
  | { kind: 'default' }
  | { kind: 'exit_code_eq'; value: number }
  | { kind: 'exit_code_in'; values: number[] }
  | { kind: 'exit_code_neq'; value: number };
```

La fonction `pickNextEdge()` (`scenarioGraph.service.ts` lignes 138-150) trie les aretes sortantes d'un noeud par `sort_order` et retient la premiere condition qui matche l'exit code du noeud precedent. La condition `default` sert de fallback si aucune autre arete ne matche.

## Cycle de vie d'un run

### Demarrage — `startRun()`

`startRun()` (`scenarioGraph.service.ts` lignes 218-315) supporte 3 modes d'entree dans le graphe :

1. **Trigger-driven** — parcours normal depuis un noeud `trigger_*` (evenement recu cote serveur)
2. **Mid-graph entry** — reprise a partir d'un `startNodeId` explicite (fonctionnalite "Run from this node" dans l'UI)
3. **Single-node test** — execution isolee d'un seul noeud (`singleNode: true`), encodee via un marqueur `'__single_node'` dans `trigger_source`, sans migration de schema dediee

Les noeuds `trigger_*` sont des executors passifs qui retournent toujours `{ exitCode: null }` — l'engine ne les "execute" jamais reellement, il demarre directement au premier voisin en aval du trigger.

### Avancement — `_advance()`

`_advance()` (`scenarioGraph.service.ts` lignes 541-558) selectionne l'arete suivante via `pickNextEdge()` selon l'exit code retourne par le noeud courant. Si aucune arete ne matche, le run est marque `success` par defaut (pas d'echec implicite), sauf dans le pattern de test isole `__single_node`.

### Protection anti-boucle

```ts
const MAX_NODE_VISITS = 100; // scenarioGraph.service.ts ligne 57
```

Si un meme noeud est visite plus de 100 fois dans un run, le run echoue immediatement avec un message d'erreur explicite mentionnant le noeud en cause — protection contre les boucles infinies, volontaires ou accidentelles, construites dans l'editeur graphique.

### Reprise apres action asynchrone — `handleNodeCommandAck()`

`handleNodeCommandAck()` (`scenarioGraph.service.ts` lignes 437-467) est le point d'entree appele par `command.service` quand une commande agent liee a un `scenario_node_run` se termine (ACK). C'est ce mecanisme qui fait avancer le graphe apres toute action asynchrone (`run_script`, `run_command`, `wait`, reprise de `cooldown`).

### Janitor de redemarrage serveur — `rearmWaitTimersOnBoot()`

`rearmWaitTimersOnBoot()` (`scenarioGraph.service.ts` lignes 160-193) tourne au demarrage du serveur : il retrouve les runs en statut `running` bloques sur un noeud `wait` suite a un reboot serveur, et soit resume immediatement l'execution (si la fenetre d'attente est deja ecoulee), soit re-arme un nouveau `setTimeout` pour le temps restant.

**Limitation MVP notee en commentaire dans le fichier** : ce janitor couvre uniquement les noeuds `wait`. En cas de redemarrage serveur pendant un fan-out multi-device en cours (`run_script`/`run_command` avec plusieurs cibles), le noeud reste bloque en `running` sans reprise automatique.