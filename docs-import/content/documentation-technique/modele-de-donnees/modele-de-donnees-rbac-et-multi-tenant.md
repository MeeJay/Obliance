Cette page couvre les deux systemes de permissions coexistants dans Obliance ainsi que le mecanisme d'isolation/fan-out multi-tenant.

## Deux systemes de permissions distincts

Obliance porte **deux mecanismes de permissions non unifies** dans le schema :

1. **RBAC groupe/device** (`team_permissions`) — controle l'acces aux entites (devices, groupes) par equipe.
2. **Permission sets** (`permission_sets`) — capabilities globales par utilisateur, notamment utilisees pour le mapping de roles SSO Obligate.

Ces deux systemes coexistent dans le code sans lien direct constate (pas de FK croisee entre `team_permissions` et `permission_sets`) — il ne faut pas supposer qu'une capability de `permission_sets` implique ou derive automatiquement d'un scope de `team_permissions`, ni l'inverse.

### RBAC groupe/device — Teams / Scopes / Levels

Schema initial (`001_initial_schema.ts`), chaine de tables :

```
user_teams (id, tenant_id, name, can_create, uuid)
        │  1-N
team_memberships (team_id, user_id)  -- PK composite

user_teams
        │  1-N
team_permissions (id, tenant_id, team_id, scope, scope_id, level)
```

- `team_permissions.scope` : enum `team_scope`, valeurs `'group'` ou `'device'` — une permission cible soit un groupe entier, soit un device precis.
- `team_permissions.scope_id` : id de l'entite ciblee (groupe ou device selon `scope`).
- `team_permissions.level` : enum `team_level`, valeurs `'ro'` ou `'rw'`.

C'est le mecanisme verifie par `permissionService` et le middleware `rbac.ts` cote serveur (cf. `server/src/middleware/`) pour toutes les routes device — `requireDeviceRead`, `requireDeviceWrite`, `requireGroupWrite`, etc. Un utilisateur non-admin sans team ne matche aucune ligne `team_permissions` et donc ne voit ni ne peut agir sur aucun device.

### Permission sets — capabilities globales

Table : `permission_sets`, creee par `server/src/db/migrations/044_permission_sets.ts` — **table separee**, sans lien de FK avec `team_permissions`.

Structure :

```
permission_sets (
  id, name, slug unique, capabilities jsonb, is_default, created_at
)
```

Trois sets sont seedes par la migration :

| Set | Capabilities (exemples) |
|---|---|
| Admin | 13 capabilities dont `users.manage`, `settings` |
| User | monitoring, `scripts.execute`, remote, files, power, updates |
| Viewer | monitoring uniquement |

Utilise par `server/src/services/permissionSet.service.ts` et `server/src/services/permission.service.ts`, ainsi que par `server/src/routes/obligateCallback.routes.ts` (mapping de roles lors du provisioning SSO Obligate). Des migrations de seed posterieures (`091`, `092`, `097` — noms de fichiers releves, contenu non lu en detail dans cette revue) alimentent egalement ce systeme.

## Isolation multi-tenant et god view

Constante centrale : `shared/src/tenants.ts`

```ts
export const MASTER_TENANT_ID = 1;

export function isMasterTenant(tenantId: number): boolean {
  return tenantId === MASTER_TENANT_ID;
}
```

Le tenant `id = 1` (Default) est le tenant **master / god view** : un admin connecte dessus voit toutes les entites de tous les tenants. Tous les autres tenants sont strictement isoles entre eux.

### Fan-out en lecture — target_tenant_ids

Migration `server/src/db/migrations/085_target_tenant_ids.ts` : ajoute une colonne `target_tenant_ids integer[]` nullable + un **index GIN** sur exactement 4 tables :

```
scripts, scenarios, script_schedules, compliance_policies
```

La migration est idempotente (verifications `hasTable`/`hasColumn` avant modification). Un commentaire dans le fichier precise explicitement le choix de design pour les teams :

> "Teams stay strictly mono-tenant by design — to grant a user access to multiple tenants, the admin creates one team per tenant."

`server/src/db/migrations/086_target_tenant_ids_extra.ts` etend vraisemblablement le meme pattern `target_tenant_ids` a `custom_sections` et `agent_api_keys` (deduit du CLAUDE.md du projet ; contenu du fichier non relu ligne a ligne dans cette revue — a verifier directement sur le fichier avant de s'appuyer dessus pour une modification de schema).

Pour `notification_channels`, le fan-out ne passe pas par un array `target_tenant_ids` mais par une table de jonction dediee : `notification_channel_tenants` (deja presente dans le schema initial `001_initial_schema.ts`).

### Pattern de requetage read-scope

Pour les 4 tables fan-outees, le scope de lecture non-master applique en general ce pattern :

```ts
if (!isMaster) {
  q.where(function() {
    this.where({ tenant_id: tenantId })
      .orWhereRaw('? = ANY(target_tenant_ids)', [tenantId]);
  });
}
```

L'ecriture reste toujours strictement scopee sur `WHERE id = ? AND tenant_id = req.tenantId` — un tenant destinataire d'un fan-out voit l'entite en lecture seule mais ne peut jamais la modifier ; seul le tenant proprietaire (typiquement master) le peut.

### Regle de securite anti-fuite

Toute requete de la forme `db('table').where({ id }).first()` **sans condition supplementaire sur `tenant_id`** est une fuite potentielle entre tenants. Le pattern attendu dans les services tenant-scopes :

```ts
const isMaster = isMasterTenant(tenantId);
const q = db('xxx').where({ id });
if (!isMaster) q.where({ tenant_id: tenantId });
const row = await q.first();
```

Cette regle s'applique a toute nouvelle requete touchant une table portant une colonne `tenant_id` — elle n'est pas verifiee automatiquement par un test ou un linter, la revue de code doit la controler manuellement sur chaque nouveau service.