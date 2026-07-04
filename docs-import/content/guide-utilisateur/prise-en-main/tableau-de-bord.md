# Le tableau de bord

Le tableau de bord est la première page que vous voyez après connexion : il donne une vue d'ensemble immédiate de l'état de votre parc d'appareils.

## En-tête de page

En haut de la page, le titre **Tableau de bord** est accompagné du nombre total d'appareils gérés. Deux boutons sont disponibles en haut à droite :

- **Ajouter un agent** (visible pour les administrateurs uniquement) ;
- **Voir tous les appareils**, qui vous amène sur la liste complète des appareils.

## Les indicateurs clés

Une première rangée de cinq cartes résume l'état global de votre parc :

| Carte | Contenu |
|---|---|
| Appareils total | Nombre total d'appareils, avec une mini-courbe d'évolution et la répartition sur les 4 derniers jours |
| En ligne | Nombre d'appareils actuellement en ligne, avec des sous-compteurs pour ceux en alerte, critiques, ou en cours de mise à jour |
| Hors ligne | Nombre d'appareils hors ligne, avec un sous-compteur pour ceux en erreur de mise à jour |
| MAJ en attente | Nombre d'appareils ayant une mise à jour en attente |
| Injoignables 72h | Nombre d'appareils qui n'ont donné aucun signe depuis plus de 72 heures |

## Graphiques et vue d'ensemble

Juste en dessous, vous trouvez :

- le graphique **Activité du parc**, qui trace l'évolution du nombre d'appareils en ligne et hors ligne, avec un choix de période (24 heures, 7 jours, 14 jours ou 30 jours) ;
- un donut **Répartition OS**, qui montre la connectivité de vos appareils par système d'exploitation ;
- cinq mini-cartes complémentaires : **Critical** (appareils en état critique), **À approuver** (appareils en attente d'approbation), **Sessions actives** (sessions de prise en main à distance en cours), **Schedules 24h** (exécutions planifiées sur les dernières 24 heures) et **Version d'agent** (répartition des versions d'agent installées).

## Cartes secondaires

Une seconde rangée propose quatre cartes complémentaires :

- **Top versions agent** : classement en barres horizontales des versions d'agent les plus répandues sur votre parc ;
- **Conformité moyenne** : jauge en arc affichant le score de conformité moyen de votre parc ;
- **Disques saturés** : liste des appareils dont l'espace disque dépasse le seuil d'alerte ;
- **Sessions remote** : vue en direct des sessions de prise en main à distance en cours (Oblireach et tunnels), avec un lien direct vers la page Supervision.

## Vue par groupe

En bas de page, la section **Vue par groupe** affiche un arbre hiérarchique de vos groupes d'appareils, avec pour chacun le nombre d'appareils en ligne, en alerte, leur taux de conformité et le nombre de mises à jour en attente. Un lien **Gérer les groupes** vous amène vers la gestion des groupes.

Si votre compte a accès au tenant principal, cette vue regroupe d'abord les groupes par tenant avant de les détailler.

## Onglets conditionnels : Hyper-V et Backups

Deux onglets supplémentaires, **Hyper-V** et **Backups** (sauvegardes Veeam), peuvent apparaître sur le tableau de bord : ils ne s'affichent que si votre parc comporte au moins une machine virtuelle Hyper-V ou un job de sauvegarde Veeam remonté par un appareil hôte. Si aucun de vos appareils ne remonte ce type d'information, ces onglets restent masqués.
