# Securite - Journal d'audit et approbations

La page **Security** est distincte de l'ecran Supervision : elle regroupe le journal d'audit et les approbations en attente. Elle est accessible aux administrateurs depuis l'entree de menu dediee, qui affiche un badge indiquant le nombre d'approbations en attente.

Cette page comporte deux onglets : **Audit log** et **Approvals**.

## Journal d'audit (Audit log)

Cet onglet, reserve aux administrateurs, retrace qui a fait quoi, quand, et depuis quelle adresse IP sur l'installation.

### Colonnes affichees

- **When** - date et heure de l'action
- **Tenant** - visible uniquement depuis le tenant master (vue globale multi-organisations)
- **Action** - type d'evenement (voir liste ci-dessous)
- **User** - utilisateur a l'origine de l'action
- **Device** - appareil concerne, le cas echeant
- **Resource** - nom de la ressource concernee (script, scenario, groupe, utilisateur, cle API, etc.)
- **IP** - adresse IP source de la requete

### Filtres disponibles

- Recherche texte libre
- Filtre par action, regroupees par famille (par exemple toutes les actions liees aux scripts, aux scenarios, aux utilisateurs...)
- Filtre par utilisateur (liste deroulante avec recherche)
- Filtre par periode (date de debut / date de fin)

Une ligne peut etre depliee pour afficher le detail technique brut de l'evenement (utile pour un diagnostic approfondi ou pour transmettre l'information au support).

### Export

Le bouton **CSV** permet d'exporter le resultat du filtre courant pour archivage ou analyse externe.

### Categories d'actions journalisees

Le journal couvre un tres large spectre d'actions, notamment : creation/modification/suppression de cles API, de scenarios, d'utilisateurs, d'equipes, de groupes, de scripts, de planifications (schedules) ; changements de role utilisateur ; demarrage/fin de session distante (avec le protocole utilise) ; activation/desactivation du mode confidentialite (privacy) et du mode isolement reseau (airgap) ; approbation/refus/suspension/transfert d'appareils ; modifications des politiques logicielles et de conformite ; modifications des restrictions de securite ; et la connexion des utilisateurs (authentification).

### Vider le journal (Clear)

Le bouton **Clear** supprime l'integralite des entrees d'audit du tenant courant. Cette action est elle-meme soumise au systeme de restrictions de securite d'Obliance : par defaut, elle necessite l'approbation d'un second administrateur avant de s'executer (niveau "restricted").  Voir la section Approbations ci-dessous pour le fonctionnement general de ce mecanisme.

Apres un vidage, une entree "audit.cleared" est immediatement reinscrite dans le journal (desormais vide), avec le nombre d'entrees supprimees en detail. Cela garantit qu'un vidage laisse toujours une trace : on sait qui a vide le journal et quand, meme si tout le reste a disparu.

### Vue multi-organisations (tenant master)

Si votre installation utilise plusieurs organisations (tenants) et que vous etes connecte sur le tenant master (l'organisation "racine"), le journal d'audit affiche par defaut les evenements de toutes les organisations, avec un filtre supplementaire pour restreindre l'affichage a une organisation precise. Ce filtre par organisation n'est disponible que depuis le tenant master.

## Approbations en attente (Approvals)

Le second onglet de la page Security liste les actions sensibles en attente de validation par un second administrateur, dans le cadre du systeme de restrictions de securite d'Obliance. Une action classee "restricted" (comme le vidage du journal d'audit) ne s'execute pas immediatement : elle apparait ici jusqu'a ce qu'un autre administrateur l'approuve ou la refuse. Le badge affiche sur l'entree de menu **Security** indique en permanence le nombre d'approbations en attente, pour attirer l'attention des administrateurs sur les actions qui necessitent leur validation.

## Bonnes pratiques

Le journal d'audit et le mecanisme d'approbation constituent une ligne de defense contre les actions destructrices ou non autorisees. Pour en tirer le meilleur parti : limitez le nombre de comptes disposant du role administrateur (moindre privilege), activez la double authentification (2FA) sur tous les comptes admin, et consultez regulierement le journal d'audit plutot qu'uniquement lors d'un incident.
