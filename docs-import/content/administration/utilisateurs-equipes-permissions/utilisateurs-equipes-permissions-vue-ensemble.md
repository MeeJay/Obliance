Obliance combine quatre mÃ©canismes indÃ©pendants pour contrÃ´ler qui peut voir et faire quoi sur la plateforme.

## OÃ¹ se trouve la gestion des utilisateurs

Le lien **Utilisateurs** n'apparaÃ®t dans le menu latÃ©ral que pour les administrateurs de la plateforme (rÃ´le global admin). La page **Utilisateurs** (`/admin/users`) contient 4 onglets :

| Onglet | Contenu |
|---|---|
| **Utilisateurs** | Liste des comptes, accÃ¨s aux tenants |
| **Ã‰quipes** | CrÃ©ation d'Ã©quipes, membres, arbre de permissions par groupe/appareil |
| **Permissions** | Jeux de permissions (matrice de capacitÃ©s valables sur tout le tenant) |
| **Restrictions** | Actions sensibles nÃ©cessitant une revÃ©rification ou une double approbation |

Un compte avec un rÃ´le Â« Admin Â» au niveau d'un tenant (voir plus bas) n'a **pas** automatiquement accÃ¨s Ã  cette page : seul le rÃ´le administrateur global de la plateforme fait apparaÃ®tre le lien dans le menu et autorise la gestion des Ã©quipes.

## Les 4 couches de contrÃ´le d'accÃ¨s

1. **Ã‰quipes â†’ PortÃ©es â†’ Niveaux** : pour les utilisateurs non-administrateurs, l'accÃ¨s aux appareils et groupes se rÃ¨gle via des Ã©quipes (dÃ©tails dans la page Â« Ã‰quipes, portÃ©es et arbre de permissions Â»).
2. **RÃ´le par tenant** : chaque utilisateur peut avoir un rÃ´le *Member* ou *Admin* propre Ã  chaque tenant auquel il a accÃ¨s. Le rÃ´le *Admin* sur un tenant fait passer outre les vÃ©rifications de capacitÃ©s pour ce tenant, mais ne donne pas accÃ¨s aux fonctions rÃ©servÃ©es Ã  l'administrateur de la plateforme (comme la gestion des Ã©quipes).
3. **Jeux de permissions** (onglet Permissions) : une matrice de capacitÃ©s valables sur l'ensemble d'un tenant, indÃ©pendante des Ã©quipes, avec trois jeux par dÃ©faut : Admin, User, Viewer.
4. **Restrictions** (onglet Restrictions) : une liste d'actions sensibles pouvant exiger une revÃ©rification (code Ã  usage unique) ou une double approbation, indÃ©pendamment des Ã©quipes.

Ces couches ne se remplacent pas : elles s'additionnent. Un administrateur global passe outre tout. Un utilisateur normal doit satisfaire les Ã‰quipes pour accÃ©der Ã  un appareil prÃ©cis, Ã©ventuellement le rÃ´le tenant et les jeux de permissions pour certaines pages transverses, et peut se voir imposer une restriction sur une action ponctuelle mÃªme s'il a par ailleurs les droits.

## GÃ©rer un compte utilisateur

### AccÃ¨s multi-tenant

L'icÃ´ne (bÃ¢timent) sur chaque ligne utilisateur ouvre le panneau **Manage tenant access**, qui permet :

- d'ajouter ou retirer l'utilisateur d'un ou plusieurs tenants,
- de lui assigner un rÃ´le par tenant : **Member** ou **Admin**.

Le rÃ´le **Admin** assignÃ© ici fait bypasser les vÃ©rifications de capacitÃ©s tenant pour ce tenant spÃ©cifique, mais reste distinct du rÃ´le administrateur global de la plateforme (qui seul donne accÃ¨s Ã  la gestion des Ã©quipes et au menu Utilisateurs).

### Cas particulier des comptes SSO

Les comptes provisionnÃ©s via **Obligate** (nom d'utilisateur prÃ©fixÃ© `og_`) ne peuvent pas Ãªtre modifiÃ©s depuis Obliance : pas de changement de mot de passe, pas de suppression, et pas de modification de leurs accÃ¨s aux tenants. Les actions correspondantes sont masquÃ©es dans l'interface pour ces comptes, et toute tentative renvoie une erreur indiquant que la gestion doit se faire depuis Obligate.

## Bonnes pratiques

- RÃ©server le rÃ´le administrateur global (celui qui donne accÃ¨s Ã  `/admin/users`) aux personnes qui doivent rÃ©ellement gÃ©rer Ã©quipes et permissions.
- Pour un responsable qui ne doit administrer qu'un seul tenant sans toucher aux Ã©quipes ni Ã  la configuration globale, utiliser le rÃ´le **Admin** de tenant plutÃ´t que le rÃ´le administrateur global.
- Appliquer le principe de moindre privilÃ¨ge : n'accorder que les accÃ¨s (Ã©quipes, rÃ´le tenant, capacitÃ©s) rÃ©ellement nÃ©cessaires Ã  chaque utilisateur, et encourager l'activation d'une authentification Ã  deux facteurs pour tous les comptes.

> Build Ã  lancer : aucun (page de documentation)