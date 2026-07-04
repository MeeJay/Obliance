Reference des types de noeuds du graphe v2, de la map `EXECUTORS` qui pilote leur execution, et des patterns de ciblage multi-device.

## ScenarioNodeType

Defini dans `shared/src/types.ts` (lignes 1913-1943), regroupe par famille :

| Famille | Types |
|---|---|
| Triggers | `trigger_manual`, `trigger_session_login`, `trigger_machine_boot`, `trigger_agent_approved`, `trigger_group_join`, `trigger_schedule_failure`, `trigger_schedule_cron`, `trigger_agent_back_online`, `trigger_metric_warning`, `trigger_metric_critical`, `trigger_metric_custom` |
| Actions | `run_script`, `run_command`, `send_notification`, `wait`, `tag_device`, `move_device_to_group` |
| Logique | `branch_exit_code`, `branch_on_device` |
| Gating | `cooldown` |
| Terminateurs | `end_success`, `end_failure` |

**A noter** : `ScenarioTriggerType` (`shared/src/types.ts` ligne 1898) inclut `schedule_cron`, `agent_back_online`, `metric_warning`, `metric_critical` et `metric_custom`, qui ne sont **pas** listes dans la section "Scenarios" du CLAUDE.md racine (limite a `session_login | machine_boot | agent_approved | group_join | schedule_failure | manual`). Le code est la reference a jour ; la doc projet racine est en retard sur ces 5 triggers.

## La map EXECUTORS

```ts
// scenarioGraph.service.ts ligne 579
const EXECUTORS: Partial<Record<ScenarioNodeType, (ctx: ExecutorContext) => Promise<ExecutorResult>>> = {
  // ...
};
```

Chaque executor retourne un `ExecutorResult` :

```ts
interface ExecutorResult {
  awaitsAck?: boolean;        // le noeud attend une ACK externe (commande agent, timer)
  terminate?: 'success' | 'failure'; // termine le run immediatement
  errorMessage?: string;
  exitCode?: number | null;
  stdout?: string;
}
```

- `awaitsAck: true` → le moteur met le run en pause jusqu'a `handleNodeCommandAck()`
- `terminate` → fin de run immediate, sans passer par une arete

## Noeud `cooldown` — gate de pacing partage

Implemente lignes 602-634 de `scenarioGraph.service.ts`.

```ts
// config
{ duration: number, unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'months' }
```

Converti en secondes via `cooldownToSeconds()`. L'etat est persiste dans la table `scenario_cooldown_state`, clef composite `(scenario_id, device_id, node_id)` — plusieurs noeuds cooldown dans un meme scenario ont des fenetres independantes, et plusieurs triggers qui convergent vers le meme noeud cooldown partagent la meme fenetre.

Comportement :
- Si le run est **dans la fenetre** de cooldown → `terminate: 'success'` avec `exitCode: -1` (pas d'echec visible dans l'audit log, le run s'arrete silencieusement)
- Sinon → met a jour `last_pass_at` et laisse passer (`exitCode: 0`)

## Noeud `run_script` (lignes 642-696)

1. Resout le script via la table `scripts` (scope tenant)
2. Calcule les devices cibles via `resolveActionTargets()` / `validateTargetsInTenant()`
3. Respecte l'isolation tenant + le privacy mode, sauf si `scenario.bypass_privacy_mode = true`
4. Enqueue une commande `run_script` par device cible via `commandService.enqueue`, avec `sourceType: 'scenario_node'`, `sourceId: nodeRunId`
5. Retourne toujours `{ awaitsAck: true }`

## Noeud `run_command` (lignes 768-793)

Meme pattern que `run_script`, avec un `commandType` type (`reboot`, `shutdown`, `install_updates`, `start_service`/`stop_service`/`restart_service`, `kill_process`, ...) et un `payload` libre.

## Noeud `wait` (lignes 742-754)

```ts
setTimeout(delayMs).unref(); // retourne awaitsAck: true
```

La reprise passe par `handleNodeCommandAck()` — voir la page architecture pour le janitor `rearmWaitTimersOnBoot()`.

## Filtrage des cibles — `validateTargetsInTenant()`

Lignes 104-119 : filtre les devices qui sont hors du tenant du scenario, ainsi que les devices en `privacy_mode_enabled = true` — sauf si `scenarios.bypass_privacy_mode = true` pour ce run.

## Fan-out multi-device

Les noeuds `run_script`, `run_command`, `tag_device` et `move_device_to_group` acceptent une configuration de ciblage multiple :

```ts
// node.config
{ targetMode: 'devices', targetDeviceIds: [12, 45, 78] }
```

Gere via la `Map` `pendingFanOuts` (lignes 59-119). Pour les noeuds asynchrones (`run_script`/`run_command`), le moteur attend **toutes** les ACKs des devices cibles avant d'avancer dans le graphe. L'exit code retenu est le **pire des exit codes** (`max`), ce qui route vers la branche d'echec si au moins un device a echoue.

**Limitation MVP** notee en commentaire : un redemarrage serveur pendant un fan-out en cours laisse le noeud bloque en `running` — ce cas n'est pas couvert par le boot janitor `rearmWaitTimersOnBoot()` (qui ne traite que les noeuds `wait`).

## Ajouter un nouveau type de noeud

Checkliste (rappelee du CLAUDE.md racine, a respecter integralement) :

1. `shared/src/types.ts` — ajouter au type union `ScenarioNodeType` (et `ScenarioTriggerType` si c'est un trigger)
2. `server/src/services/scenarioGraph.service.ts` — ajouter une entree dans `EXECUTORS`. Trigger passif : `'trigger_xxx': async () => ({ exitCode: null })`
3. `server/src/services/scenario.service.ts`, dans `importScenario()` — ajouter au `VALID_NODE_TYPES` Set (ligne 679), sinon l'import rejette l'entree avec `unknown node type`
4. `server/src/services/scenario.service.ts`, dans `getDummyExportTemplate()` (ligne 984) — ajouter un noeud de demonstration commente
5. `client/src/components/scenarios/scenarioNodeRegistry.ts` — entree `NODE_TYPES` (`category`/`accent`/`hint`/`defaultConfig`/`fields[]`)

Pour un trigger evenementiel (push, cron...), ajouter aussi le `fireTrigger` correspondant dans le code emetteur (ex. `device.service.ts` pour les triggers `metric_*`) et le filtre de routage dans `scenario.service.ts` `fireTrigger`.