# Plugins de notification

Obliance expose un systeme de plugins pour l'envoi de notifications (alertes monitors, agents, groupes) vers des canaux externes, avec une interface commune et un registre central.

## Emplacement et inventaire

```
server/src/notifications/
├── types.ts             # Interface NotificationPlugin + NotificationPayload
├── registry.ts           # Registre central des plugins
└── plugins/
    ├── discord.ts
    ├── freemobile.ts
    ├── gotify.ts
    ├── ntfy.ts
    ├── pushover.ts
    ├── slack.ts
    ├── smtp.ts
    ├── teams.ts
    ├── telegram.ts
    └── webhook.ts
```

10 plugins au total, tous enregistres dans `registry.ts` — aucun fichier orphelin.

## Interface commune — `server/src/notifications/types.ts`

```ts
interface NotificationPlugin {
  type: string;
  name: string;
  description: string;
  configFields: /* schema des champs de config attendus */;
  send(config, payload: NotificationPayload): Promise<void>;
  sendTest(config): Promise<void>;
}
```

`NotificationPayload` transporte :

```ts
{
  monitorName: string;
  monitorUrl?: string;
  oldStatus: string;
  newStatus: string;
  message?: string;
  timestamp: ...;
  appName?: string;
  // champs specifiques aux notifications de groupe
  groupName?: string;
  groupId?: ...;
  downMonitors?: ...;
  isGroupNotification?: boolean;
}
```

## Registre — `server/src/notifications/registry.ts`

Au demarrage du serveur, `registry.ts` :

- Enregistre les 10 plugins built-in dans une `Map<type, plugin>`.
- Expose `getPlugin(type)`, `getAllPlugins()`, `getPluginMetas()` (consomme par l'UI de configuration cote client).
- Expose `registerPlugin()` pour permettre l'extension (ajout de plugins hors du set built-in).

## Deux plugins de reference

### `webhookPlugin` — `server/src/notifications/plugins/webhook.ts`

- POST JSON generique vers une URL fournie par l'utilisateur.
- Header `Authorization` optionnel, construit depuis `config.secret`.
- **Protection SSRF obligatoire** : passe par `assertPublicHttpUrl()` (`server/src/utils/ssrfGuard.ts`) avant tout `fetch`.
- Timeout de requete : `10000ms` via `AbortSignal.timeout()`.

### `slackPlugin` — `server/src/notifications/plugins/slack.ts`

- POST vers un Slack **Incoming Webhook URL** (`config.webhookUrl`).
- Formatte un message riche (`attachments`/`blocks`) avec icone et couleur mappees par statut : `up`, `alert`, `ssl_warning`, `ssl_expired`, `inactive`, `value_changed`.
- **Ne passe pas** par `assertPublicHttpUrl()` — contrairement au plugin `webhook.ts` generique, l'URL Slack n'est pas soumise a la garde SSRF.

> Les 8 autres plugins (`discord.ts`, `telegram.ts`, `gotify.ts`, `ntfy.ts`, `pushover.ts`, `smtp.ts`, `teams.ts`, `freemobile.ts`) n'ont pas ete lus en detail dans ce lot ; `webhook.ts` et `slack.ts` servent ici de references representatives du pattern d'architecture plugin.

## Garde anti-SSRF — `server/src/utils/ssrfGuard.ts`

`assertPublicHttpUrl()` bloque toute resolution DNS vers des plages privees/loopback/link-local/metadata avant l'emission de la requete HTTP :

| Plage | Description |
|---|---|
| `10.0.0.0/8` | Privee RFC 1918 |
| `172.16.0.0/12` | Privee RFC 1918 |
| `192.168.0.0/16` | Privee RFC 1918 |
| `127.0.0.0/8` | Loopback |
| `169.254.0.0/16` | Link-local, inclut `169.254.169.254` (metadata AWS) |
| `100.64.0.0/10` | CGNAT |
| `::1` | Loopback IPv6 |
| `fc00::/7` | Unique local address IPv6 |
| `fe80::/10` | Link-local IPv6 |

La resolution DNS est effectuee **avant** l'emission de la requete, specifiquement pour contrer une attaque par CNAME pointant vers une IP interne — mecanisme documente dans le code comme **best-effort** (pas une garantie absolue contre toute technique de contournement DNS).

## Points d'entree consommant le registre

`server/src/services/notification.service.ts` importe `getPlugin` depuis `notifications/registry` et l'utilise dans :

| Methode | Ligne | Usage |
|---|---|---|
| `sendForMonitor` | 459 | Notification suite a un changement de statut monitor |
| `sendForAgent` | 753 | Notification suite a un evenement agent |
| `sendForGroup` | 832 | Notification agregee de groupe |
| (creation/test de channel) | 123, 210 | Validation d'un channel a la creation, bouton "Tester" |

## Routes API — `server/src/routes/notifications.routes.ts`

Toutes les routes sont protegees par `requireAuth` + `requireRole('admin')` :

```
GET    /plugins
CRUD   /channels
POST   /channels/:id/test
GET    /channels/:id/tenants
PUT    /channels/:id/tenants
... /bindings   # liaison channels <-> evenements
```

Le partage multi-tenant d'un channel de notification passe par la table de jonction `notification_channel_tenants` (pattern coherent avec le fan-out documente pour `scripts`/`scenarios`/`script_schedules`/`compliance_policies`, mais implemente via table de jonction plutot que colonne `target_tenant_ids INT[]`). L'UI correspondante est deja en place dans `NotificationsPage` (cote client).
