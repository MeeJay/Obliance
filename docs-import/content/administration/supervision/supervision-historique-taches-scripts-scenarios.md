# Historique des taches, scripts et scenarios

Ce chapitre decrit l'onglet **Historique** (*History*) de la page Supervision, qui centralise tout ce qui s'est execute sur le parc : taches, scripts, mises a jour et scenarios.

## Acces

L'onglet **Historique** (*History*) se trouve dans **Supervision** (`/admin/supervision`), au meme titre que **Sessions distantes** et **Rapports**. La regle d'acces est identique aux deux autres onglets : compte administrateur, ou utilisateur dont l'equipe dispose de la capacite **`supervision:read`**.

L'onglet est divise en deux sous-onglets : **Tasks & Scripts** et **Scenarios**.

## Sous-onglet Tasks & Scripts

Ce sous-onglet regroupe dans une seule liste, triee par date decroissante, trois familles d'evenements :

- les **commandes** envoyees aux agents,
- les **executions de scripts**,
- les **mises a jour d'appareils** (Windows Update, winget, chocolatey, etc.).

Outils disponibles au-dessus de la table :

- un filtre par type d'evenement : **All**, **Tasks**, **Scripts**, **Updates** ;
- une recherche texte libre, qui porte sur le nom de la tache, le nom de l'appareil et le sous-libelle de l'evenement ;
- une pagination par lots de 50 lignes, via le bouton **Load {N} more** en bas de liste (pas de defilement infini automatique â€” il faut cliquer pour charger la suite).

Colonnes de la table :

| Colonne | Contenu |
|---|---|
| Date | Horodatage de l'evenement |
| Type | Badge Task / Script / Update |
| Action | Nom de la tache, du script ou de la mise a jour |
| Device | Nom de l'appareil concerne, cliquable vers sa fiche detail |
| Status | Statut d'execution (succes, echec, en cours, etc. selon le type) |
| User | Utilisateur a l'origine de l'action, quand applicable |
| Duration | Duree d'execution |

Les statuts se mettent a jour en temps reel dans le navigateur des qu'une commande ou un script en cours se termine, sans necessiter de rafraichissement de page.

## Sous-onglet Scenarios

Ce sous-onglet liste les **executions de scenarios** (automatisations conditionnelles chainant des scripts de verification et de resolution). Colonnes affichees :

| Colonne | Contenu |
|---|---|
| Date | Horodatage de declenchement |
| Scenario | Nom du scenario execute |
| Device | Appareil concerne |
| Trigger | Evenement qui a declenche le scenario |
| Status | Statut global de l'execution |
| Duration | Duree totale |

La colonne **Trigger** correspond a l'evenement qui a declenche le scenario : connexion d'une session utilisateur, demarrage de la machine, approbation de l'agent, changement de groupe, echec d'une planification, ou declenchement manuel.

Chaque ligne est **cliquable et depliable** : elle affiche alors le detail etape par etape du scenario, avec pour chaque etape les codes de sortie des scripts de verification (*check*), de resolution (*resolve*) et de re-verification (*recheck*), ainsi que le message d'erreur eventuel en cas d'echec. C'est la vue la plus utile pour diagnostiquer pourquoi un scenario s'est arrete a une etape donnee.

## Filtrage des donnees visibles et anonymisation

L'historique respecte le **meme controle d'acces** que le reste de l'application : un utilisateur non-administrateur, meme avec la capacite `supervision:read`, ne verra dans l'historique que les evenements relatifs aux appareils et groupes auxquels il a par ailleurs acces en lecture. Un evenement sur un appareil hors de son perimetre n'apparaitra simplement pas dans la liste.

Un mode **anonymisation** existe comme preference personnelle, activable depuis vos parametres utilisateur : lorsqu'il est active, les noms d'appareils et d'utilisateurs affiches dans l'historique sont masques (seule la premiere lettre est conservee, suivie de points). Ce mode est pratique pour realiser des captures d'ecran de demonstration ou de documentation sans exposer de donnees reelles du parc.