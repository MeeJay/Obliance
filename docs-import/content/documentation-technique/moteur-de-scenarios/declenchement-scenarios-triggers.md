# Declenchement des scenarios (triggers)

Cette page decrit comment un evenement metier (push agent, schedule, changement de groupe...) se transforme en run de scenario, du filtrage en base jusqu'au demarrage du graphe v2.

## `fireTrigger()` â€” point d'entree commun

`server/src/services/scenario.service.ts`, lignes 1321-1487. Contrairement a une approche "un run par scenario", `fireTrigger()` dispatche **par ligne `scenario_nodes` correspondante** â€” un scenario peut donc, en theorie, avoir plusieurs noeuds trigger du meme type et recevoir plusieurs evaluations independantes.

Pour chaque noeud trigger candidat, `fireTrigger()` applique un filtre specifique lu depuis la **config du noeud trigger lui-meme** :

| Type de trigger | Filtre applique | Source de la config |
|---|---|---|
| `trigger_schedule_failure` | `scheduleId` doit matcher | config du noeud |
| `trigger_group_join` | `groupIds` doit contenir le groupe cible | config du noeud |
| `trigger_agent_back_online` | debounce `offlineDelaySeconds` | config du noeud |
| `trigger_metric_warning` / `trigger_metric_critical` | `metric` + `mount` (le cas echeant) | config du noeud |
| `trigger_metric_custom` | `metric` + `comparator` + `threshold` + `mount`, avec exclusion des filesystems amovibles/optiques pour les montages disque | config du noeud |
| `trigger_agent_approved` | dedup one-shot via une requete sur `scenario_runs` | â€” |

Une fois le filtre passe, `fireTrigger()` appelle :

```ts
scenarioGraphService.startRun(scenario.id, deviceId, {
  triggerType,
  triggerSource,
  triggerNodeId: tn.node_id,
});
```

## Cache hot-path : `triggerExistCache`

`server/src/services/scenario.service.ts`, lignes 17-34. C'est un `Map<tenantId + triggerNodeType, count>` en memoire avec **TTL de 20 secondes**, dont le role est d'eviter une jointure `scenario_nodes â‹ˆ scenarios` a **chaque push agent** lorsque le tenant appelant ne possede aucun scenario actif de ce type de trigger.

`bustTriggerExistCache()` est appelee explicitement a l'activation/desactivation d'un scenario, pour que l'effet soit immediat (pas d'attente des 20s de TTL avant qu'un scenario nouvellement active commence a matcher).

## `startRun()` â€” demarrage du run cote graphe v2

`server/src/services/scenarioGraph.service.ts`, lignes 218-315.

### Porte privacy mode

En tout premier, `startRun()` verifie `device.privacy_mode_enabled`. Si vrai **et** `scenario.bypass_privacy_mode` est faux, la creation du run est silencieusement annulee (aucune ligne `scenario_runs` creee, retour d'une chaine vide).

### Trois modes d'entree

1. **Walk pilote par trigger** (mode par defaut) : le graphe est parcouru depuis le noeud trigger identifie par `fireTrigger()`.
2. **Entree en milieu de graphe** via `startNodeId`.
3. **Test "un seul noeud"** via le flag `singleNode` (voir page precedente, endpoint `start-graph-run`).

### Resilience

L'integralite de la chaine `executeNode` est enveloppee dans un `try/catch` : un echec du moteur au niveau le plus haut retourne quand meme un `runId` (le run est marque en echec), plutot que de faire remonter une erreur 500 brute a l'appelant.

## Sources d'evenements agent

Le CLAUDE.md du repo documente deux evenements remontes par l'agent Go dans le corps du push (`push.go`) :

- `machine_boot` â€” emis au demarrage de l'agent
- `session_login` â€” nouvelle session WTS Windows detectee (poll toutes les 10s, `session_monitor_windows.go`)

Ces events, une fois recus cote serveur, sont routes vers `fireTrigger()` pour les types de trigger correspondants (`trigger_machine_boot`, `trigger_session_login`).

## Lien Schedule â†’ Scenario

Un `script_schedule` configure avec `assertPass` peut porter un `onFailureScenarioId`. En cas d'echec de l'assertion, le schedule declenche automatiquement le scenario cible via le trigger `trigger_schedule_failure`, filtre par `scheduleId` comme decrit plus haut.

## Recapitulatif du flux complet

```
Evenement metier (push agent, cron, changement de groupe, echec de schedule...)
  â†’ fireTrigger(tenantId, triggerType, ...)
      â†’ lookup scenario_nodes via triggerExistCache (hot-path, TTL 20s)
      â†’ pour chaque noeud trigger candidat :
          â†’ filtre specifique au type (scheduleId / groupIds / debounce / metric+seuil / dedup)
          â†’ scenarioGraphService.startRun(scenarioId, deviceId, { triggerType, triggerSource, triggerNodeId })
              â†’ porte privacy_mode (skip silencieux si bloque)
              â†’ creation scenario_runs + walk du graphe depuis le noeud trigger
              â†’ executeNode() en chaine via EXECUTORS + pickNextEdge()
```