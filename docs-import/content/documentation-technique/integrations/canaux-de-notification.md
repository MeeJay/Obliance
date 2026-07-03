# Canaux de notification

Obliance integre 10 plugins de notification sortante, une resolution de canaux par heritage hierarchique (Global â†’ Groupe â†’ Moniteur/Agent), et un partage de canaux inter-tenant via table de jonction.

## Registry des plugins

`server/src/notifications/registry.ts` enregistre 10 plugins integres :

```ts
webhook, discord, telegram, slack, teams, gotify, ntfy, pushover, smtp, freemobile
```

Le type union correspondant est defini dans `shared/src/types.ts` (lignes 1422-1424) et correspond exactement a ces 10 valeurs :

```ts
export type NotificationChannelType =
  'webhook' | 'discord' | 'telegram' | 'slack' | 'teams' |
  'gotify' | 'ntfy' | 'pushover' | 'smtp' | 'freemobile';
```

## Interface commune

Chaque plugin implemente `NotificationPlugin` (`server/src/notifications/types.ts` lignes 18-26) :

```ts
interface NotificationPlugin {
  type: string;
  name: string;
  description: string;
  configFields: ...;
  send(config, payload): Promise<...>;
  sendTest(config): Promise<...>;
}
```

Le payload transmis (`NotificationPayload`, lignes 3-16) porte :

```ts
{
  monitorName, monitorUrl, oldStatus, newStatus, message, timestamp, appName,
  // champs specifiques aux notifications de groupe :
  groupName, groupId, downMonitors, isGroupNotification
}
```

## Detail par plugin

### webhook.ts â€” le seul avec garde anti-SSRF

`server/src/notifications/plugins/webhook.ts` est **le seul plugin** du registry a passer l'URL cible dans `assertPublicHttpUrl()` (`server/src/utils/ssrfGuard.ts`) avant d'emettre le fetch. Cette garde resout le DNS puis bloque :

- Adresses IPv4/IPv6 privees
- Loopback
- Link-local (dont `169.254.169.254`, l'endpoint metadata cloud AWS/GCP/Azure)
- Plages CGNAT

**Point de vigilance pour un audit** : lors de l'ajout ou de la revue d'un plugin qui accepte une URL de serveur saisie par un admin (ex. un champ `serverUrl`), verifier systematiquement qu'il applique bien ce meme garde-fou `assertPublicHttpUrl()` avant tout appel HTTP sortant â€” ce n'est pas un standard applique uniformement a tous les plugins existants du registry.

### teams.ts â€” Adaptive Card

Construit une Adaptive Card MS Teams v1.4 via `buildAdaptiveCard()` (lignes 30-126) :

- `containerStyle` mappe dynamiquement sur le statut (`good` / `attention` / `warning` / `emphasis` / `default`)
- `FactSet` genere dynamiquement a partir du payload

### slack.ts et discord.ts

- **slack.ts** poste des `attachments[].blocks` au format `mrkdwn`.
- **discord.ts** poste des `embeds[]` colores via `STATUS_COLORS_HEX` (`server/src/notifications/statusIcons.ts`).

Les deux utilisent l'URL de webhook entrant fournie par l'admin (`config.webhookUrl`).

### telegram.ts â€” choix deliberes anti-faux-positif AV

Deux particularites documentees en commentaire dans le fichier :

1. Utilise **MarkdownV2** et non HTML, deliberement â€” un format HTML declenchait un faux-positif Windows Defender documente (`Trojan:HTML/FakeLogin.AS!atmn`).
2. Construit l'URL de l'API Telegram (`https://api.telegram.org/bot<token>/sendMessage`) en **concatenant des chaines classiques plutot qu'un template literal**, pour la meme raison de faux-positif antivirus. Ce choix est deliberement documente en commentaire dans le fichier â€” ne pas le "nettoyer" en template literal lors d'un refacto.

### smtp.ts

`server/src/notifications/plugins/smtp.ts` utilise `nodemailer` et applique deux protections cote contenu :

- `escapeHtml()` sur les noms de moniteur/device â€” ces valeurs peuvent etre controlees par un agent ou un admin, donc traitees comme non fiables avant injection dans le corps HTML de l'email.
- `safeHref()` restreint les liens `href` du corps a `http`/`https` uniquement â€” empeche l'injection de schemes dangereux (`javascript:`, `data:`, etc.) dans l'email genere.

### Autres plugins

`gotify.ts`, `ntfy.ts`, `pushover.ts`, `freemobile.ts` completent le registry â€” chacun avec ses `configFields` propres consultables via l'endpoint `GET /plugins`.

## Resolution des canaux â€” heritage hierarchique

`server/src/services/notification.service.ts` resout les canaux actifs pour un evenement selon une chaine d'heritage a 3 niveaux :

```
Global â†’ Groupe (ancetres root â†’ leaf via device_group_closure) â†’ Moniteur/Agent
```

### Fonctions de resolution

| Fonction | Cible |
|---|---|
| `resolveChannelsForMonitor` | Un moniteur HTTP/TCP/etc. specifique |
| `resolveChannelsForAgent` | Un agent/device specifique |
| `resolveChannelsForGroup` | Un groupe de devices |

### Modes de binding

La fonction interne `_applyBindings` combine les canaux herites selon 3 modes : `merge`, `replace`, `exclude`.

### Envoi et journalisation

`sendForMonitor`, `sendForAgent`, `sendForGroup` declenchent l'envoi effectif ; chaque tentative est journalisee via `logNotification()` dans la table `notification_log`.

### resolveChannelConfig â€” mutualisation SMTP

`resolveChannelConfig()` (lignes 189-204) gere un cas particulier pour un canal de type `smtp` : si `config.smtpServerId` est renseigne, la fonction va chercher les credentials du serveur SMTP global via `smtpServerService.getTransportConfig()` et les injecte dans la config du canal. Cela permet de centraliser un seul serveur SMTP partage par plusieurs canaux de notification distincts, sans dupliquer le mot de passe SMTP dans chaque canal.

## Partage de canaux inter-tenant

Le partage d'un canal de notification entre tenants passe par une table de jonction dediee â€” **distincte** du mecanisme de fan-out par colonne array `target_tenant_ids` utilise pour `scripts` / `scenarios` / `script_schedules` / `compliance_policies` (migrations `085`/`086`).

```
Table : notification_channel_tenants
Origine : server/src/db/migrations/001_initial_schema.ts (ligne 278) â€” migration initiale, PAS 085/086
```

### Fonctions de gestion

- `notificationService.getChannelTenants()` â€” liste les tenants ayant acces a un canal.
- `notificationService.setChannelTenants()` â€” definit la liste.

### Masquage des secrets â€” redactConfig()

Quand l'appelant n'est **pas proprietaire** du canal (tenant non-master, different du tenant owner), `redactConfig()` masque les champs de config dont le nom matche :

```
/(secret|token|password|webhook|api[_-]?key|key)$/i
```

Ces champs sont remplaces par la valeur litterale `__REDACTED__`. Le client recoit egalement un champ `readOnly: true` pour desactiver l'edition en UI.

## Routes â€” admin uniquement

`server/src/routes/notifications.routes.ts` est **entierement** protege par `requireRole('admin')` (ligne 16) â€” aucun endpoint de ce fichier n'est accessible a un role `user`, meme en lecture.

| Endpoint | Role |
|---|---|
| `GET /plugins` | Liste les plugins disponibles + leurs `configFields` |
| `GET/POST/PUT/DELETE /channels` | CRUD des canaux |
| `POST /channels/:id/test` | Declenche `sendTest()` du plugin |
| `GET/PUT /channels/:id/tenants` | Lecture/ecriture du partage cross-tenant |
| `GET /bindings` | Liste les bindings bruts |
| `GET /bindings/resolved` | Liste les bindings apres resolution d'heritage |
| `POST/DELETE /bindings` | Creation/suppression d'un binding |

## Points d'attention

- Avant d'ajouter un 11e plugin, suivre le pattern existant : implementer `NotificationPlugin`, l'enregistrer dans `registry.ts`, ajouter sa valeur au type union `NotificationChannelType` dans `shared/src/types.ts` (lignes 1422-1424).
- Si le nouveau plugin accepte une URL de serveur saisie par un admin, appliquer systematiquement `assertPublicHttpUrl()` (`server/src/utils/ssrfGuard.ts`) plutot que de supposer qu'un garde-fou equivalent est deja present ailleurs dans le registry â€” seul `webhook.ts` l'applique aujourd'hui.
- Ne pas confondre les deux mecanismes de partage cross-tenant : `notification_channel_tenants` (table de jonction, notifications uniquement) vs `target_tenant_ids` (colonne array + index GIN, scripts/scenarios/schedules/compliance).