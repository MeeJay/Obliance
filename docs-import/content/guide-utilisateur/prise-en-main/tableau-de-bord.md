# Le tableau de bord

Le tableau de bord est la premiÃ¨re page que vous voyez aprÃ¨s connexion : il donne une vue d'ensemble immÃ©diate de l'Ã©tat de votre parc d'appareils.

## En-tÃªte de page

En haut de la page, le titre **Tableau de bord** est accompagnÃ© du nombre total d'appareils gÃ©rÃ©s. Deux boutons sont disponibles en haut Ã  droite :

- **Ajouter un agent** (visible pour les administrateurs uniquement) ;
- **Voir tous les appareils**, qui vous amÃ¨ne sur la liste complÃ¨te des appareils.

## Les indicateurs clÃ©s

Une premiÃ¨re rangÃ©e de cinq cartes rÃ©sume l'Ã©tat global de votre parc :

| Carte | Contenu |
|---|---|
| Appareils total | Nombre total d'appareils, avec une mini-courbe d'Ã©volution et la rÃ©partition sur les 4 derniers jours |
| En ligne | Nombre d'appareils actuellement en ligne, avec des sous-compteurs pour ceux en alerte, critiques, ou en cours de mise Ã  jour |
| Hors ligne | Nombre d'appareils hors ligne, avec un sous-compteur pour ceux en erreur de mise Ã  jour |
| MAJ en attente | Nombre d'appareils ayant une mise Ã  jour en attente |
| Injoignables 72h | Nombre d'appareils qui n'ont donnÃ© aucun signe depuis plus de 72 heures |

## Graphiques et vue d'ensemble

Juste en dessous, vous trouvez :

- le graphique **ActivitÃ© du parc**, qui trace l'Ã©volution du nombre d'appareils en ligne et hors ligne, avec un choix de pÃ©riode (24 heures, 7 jours, 14 jours ou 30 jours) ;
- un donut **RÃ©partition OS**, qui montre la connectivitÃ© de vos appareils par systÃ¨me d'exploitation ;
- cinq mini-cartes complÃ©mentaires : **Critical** (appareils en Ã©tat critique), **Ã€ approuver** (appareils en attente d'approbation), **Sessions actives** (sessions de prise en main Ã  distance en cours), **Schedules 24h** (exÃ©cutions planifiÃ©es sur les derniÃ¨res 24 heures) et **Version d'agent** (rÃ©partition des versions d'agent installÃ©es).

## Cartes secondaires

Une seconde rangÃ©e propose quatre cartes complÃ©mentaires :

- **Top versions agent** : classement en barres horizontales des versions d'agent les plus rÃ©pandues sur votre parc ;
- **ConformitÃ© moyenne** : jauge en arc affichant le score de conformitÃ© moyen de votre parc ;
- **Disques saturÃ©s** : liste des appareils dont l'espace disque dÃ©passe le seuil d'alerte ;
- **Sessions remote** : vue en direct des sessions de prise en main Ã  distance en cours (Oblireach et tunnels), avec un lien direct vers la page Supervision.

## Vue par groupe

En bas de page, la section **Vue par groupe** affiche un arbre hiÃ©rarchique de vos groupes d'appareils, avec pour chacun le nombre d'appareils en ligne, en alerte, leur taux de conformitÃ© et le nombre de mises Ã  jour en attente. Un lien **GÃ©rer les groupes** vous amÃ¨ne vers la gestion des groupes.

Si votre compte a accÃ¨s au tenant principal, cette vue regroupe d'abord les groupes par tenant avant de les dÃ©tailler.

## Onglets conditionnels : Hyper-V et Backups

Deux onglets supplÃ©mentaires, **Hyper-V** et **Backups** (sauvegardes Veeam), peuvent apparaÃ®tre sur le tableau de bord : ils ne s'affichent que si votre parc comporte au moins une machine virtuelle Hyper-V ou un job de sauvegarde Veeam remontÃ© par un appareil hÃ´te. Si aucun de vos appareils ne remonte ce type d'information, ces onglets restent masquÃ©s.
