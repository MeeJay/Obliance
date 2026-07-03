# Architecture du moteur de scenarios

Obliance orchestre les automations conditionnelles ("scenarios") cote serveur via une state machine pilotee par les ACKs de commandes agent, avec deux moteurs d'execution qui coexistent aujourd'hui dans le code.

## Deux moteurs, un seul actif

Le repo contient historiquement deux implementations completes du moteur d'orchestration :

| | Moteur v1 (legacy, lineaire) | Moteur v2 (graphe, actif) |
|---|---|---|
| Fichier | `server/src/services/scenario.service.ts` | `server/src/services/scenarioGraph.service.ts` |
| Modele | Etapes lineaires check â†’ resolve â†’ recheck | Graphe de noeuds relies par des edges conditionnelles |
| Tables | `scenario_steps`, `scenario_step_runs` | `scenario_nodes`, `scenario_edges`, `scenario_node_runs` |
| Migration Knex | `server/src/db/migrations/050_scenarios.ts` | `server/src/db/migrations/074_scenarios_v2_graph.ts` |
| Fonctions cles | `executeNextStep` (ligne ~1591), `handleScenarioCommandAck` (ligne ~1686) | `startRun`, `executeNode`, `handleNodeCommandAck`, `_advance` |
| Statut | Dead code conserve pour rollback | Seul moteur declenchable en pratique |

Le commentaire aux lignes ~1506-1517 de `scenario.service.ts` est explicite :

```
// Phase 1G: v2 is now the ONLY engine...
// If we somehow get here without nodes, surface a clear error...
// The v1 code paths past this point are dead code kept temporarily
// for rollback â€” see Phase 1H drop.
```

`triggerScenario()` leve une erreur `Scenario ${scenarioId} has no graph nodes...` des qu'un scenario n'a pas de lignes dans `scenario_nodes` â€” ce qui rend le flow lineaire check â†’ resolve â†’ recheck **inatteignable** via les chemins normaux (triggers, declenchement manuel, schedule). Le code d'ACK du moteur v1 (`handleScenarioCommandAck`, definie dans `scenario.service.ts`) reste neanmoins cable : `server/src/services/command.service.ts` contient deux points de routage (lignes ~505 et ~604) qui distinguent les deux moteurs par le champ `source_type` de la commande â€”

- `source_type === 'scenario_step_check' | 'scenario_step_resolve' | 'scenario_step_recheck'` â†’ route vers `handleScenarioCommandAck` (moteur v1, `scenario.service.ts`)
- `source_type === 'scenario_node'` â†’ route vers `handleNodeCommandAck` (moteur v2, `scenarioGraph.service.ts`, lignes ~526 et ~596)

**Consequence pratique pour le developpeur** : toute nouvelle feature d'orchestration doit etre ecrite dans `scenarioGraph.service.ts`. Le modele check/resolve/recheck decrit ci-dessous n'est documente qu'a titre historique â€” il ne doit plus etre considere comme le comportement courant du produit.

## Le flow legacy check â†’ resolve â†’ recheck (historique)

Le moteur v1 modelisait chaque etape (`ScenarioStep`) comme :

```
Etape â†’ check script â†’ exit 0 ?
  OUI â†’ etape suivante
  NON â†’ resolve script â†’ re-run check â†’ exit 0 ?
    OUI â†’ etape suivante
    NON â†’ SCENARIO ECHOUE
```

Ce modele est converti automatiquement vers le graphe v2 : `buildV2GraphFromV1Steps()` (`server/src/services/scenarioMigrate.service.ts`) transforme chaque etape legacy en jusqu'a 5 noeuds v2 :

```
run_script(check)
  -> branch_exit_code
       -> [edge exit_code_eq:0] noeud suivant
       -> [edge default] run_script(resolve)
            -> run_script(recheck)
                 -> branch_exit_code(recheck)
                      -> [edge exit_code_eq:0] noeud suivant
                      -> [edge default] end_failure
```

`migrateScenarioToV2()` est idempotente (elle ne fait rien si `scenario_nodes` contient deja des lignes pour le scenario) et est invoquee automatiquement a trois endroits :

1. A la creation d'un scenario â€” `server/src/routes/scenario.routes.ts`, route `POST /` (ligne ~303-309)
2. A l'instanciation d'un template â€” meme fichier, ligne ~176-183
3. Au demarrage du serveur, via `migrateAllV1Scenarios()`

## Le graphe v2 en detail

### Types de noeuds (`ScenarioNodeType`)

Definis dans `shared/src/types.ts` (lignes 1913-1943), la table `ScenarioNodeType` regroupe 4 familles :

```ts
// Triggers (passifs, no-op cote execution)
'trigger_manual' | 'trigger_session_login' | 'trigger_machine_boot' |
'trigger_agent_approved' | 'trigger_group_join' | 'trigger_schedule_failure' |
'trigger_schedule_cron' | 'trigger_agent_back_online' |
'trigger_metric_warning' | 'trigger_metric_critical' | 'trigger_metric_custom'

// Actions
'run_script' | 'run_command' | 'send_notification' | 'wait' |
'tag_device' | 'move_device_to_group'

// Logique
'branch_exit_code' | 'branch_on_device'

// Gating
'cooldown'

// Terminateurs
'end_success' | 'end_failure'
```

Note : `ScenarioTriggerType` (`shared/src/types.ts`, ligne 1898) inclut `schedule_cron`, `agent_back_online`, `metric_warning`, `metric_critical`, `metric_custom` en plus des 6 triggers historiques listes dans le CLAUDE.md du repo (`session_login`, `machine_boot`, `agent_approved`, `group_join`, `schedule_failure`, `manual`) â€” la liste courte du CLAUDE.md est incomplete par rapport au type reellement expose.

### Conditions d'edge (`ScenarioEdgeCondition`)

Union discriminee (`shared/src/types.ts`, lignes 1960-1965), 5 formes possibles :

```ts
{ kind: 'always' }
{ kind: 'default' }                          // uniquement en fallback
{ kind: 'exit_code_eq', value: number }
{ kind: 'exit_code_in', values: number[] }
{ kind: 'exit_code_neq', value: number }
```

### Selection de l'edge suivante

`pickNextEdge()` (`server/src/services/scenarioGraph.service.ts`, lignes 138-150) recupere les edges du noeud courant triees par `sort_order`, et retient la premiere dont la condition (hors `default`) matche le code de sortie du noeud precedent. Si aucune ne matche, elle retombe sur une edge de type `default` si elle existe. **S'il n'y a aucune edge du tout**, `_advance` (lignes 541-558) traite ca comme une fin de run reussie â€” il n'y a pas d'echec dur en l'absence de correspondance.

### Garde-fou anti-cycle

`MAX_NODE_VISITS = 100` (ligne 57) limite le nombre de visites par couple (run, noeud). Au-dela de cette limite, le run est marque en echec avec un message d'erreur mentionnant un cycle probable ("likely cycle").

### Reprise apres redemarrage serveur

`rearmWaitTimersOnBoot()` (lignes 160-193) est un janitor de boot qui retrouve les noeuds `wait` orphelins (run `status='running'`, node run `status='running'`) laisses par un redemarrage serveur en plein milieu d'un timer, et soit reprend immediatement l'execution soit re-arme le `setTimeout` restant.

## Tables de base de donnees

| Moteur | Tables | Migration |
|---|---|---|
| v1 (legacy) | `scenario_steps`, `scenario_step_runs` | `server/src/db/migrations/050_scenarios.ts` |
| v2 (actif) | `scenario_nodes`, `scenario_edges`, `scenario_node_runs` | `server/src/db/migrations/074_scenarios_v2_graph.ts` |
| Commun | `scenarios`, `scenario_runs`, `scenario_trigger_log` | â€” |
| Cooldown | `scenario_cooldown_state` | `server/src/db/migrations/087_scenario_cooldown_node.ts` |

A titre indicatif, le repo compte 122 fichiers de migration sous `server/src/db/migrations/` au moment de la redaction â€” un chiffre plus eleve que celui mentionne ailleurs dans la documentation projet, qui date probablement d'une version anterieure du repo.