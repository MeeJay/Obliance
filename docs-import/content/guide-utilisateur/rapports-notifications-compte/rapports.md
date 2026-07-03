Les rapports permettent de generer des documents recapitulatifs sur votre parc d'appareils (etat general, conformite, mises a jour, logiciels installes, historique de scripts) et de les telecharger dans differents formats.

## Ou trouver les rapports

Les rapports se trouvent dans **Supervision > Rapports** (menu reserve aux administrateurs, ou aux utilisateurs a qui un administrateur a explicitement donne l'acces via une equipe et un jeu de permissions). Si vous ne voyez pas cet onglet, cela signifie que votre compte n'a pas ete autorise a le consulter â€” adressez-vous a votre administrateur.

Une fois sur la page, vous arrivez sur la liste des rapports deja crees, avec la possibilite de filtrer par type de rapport.

## Types de rapports disponibles

| Type | Contenu |
|---|---|
| Fleet Overview | Vue d'ensemble de l'etat du parc d'appareils |
| Compliance | Etat de conformite des appareils par rapport aux politiques appliquees |
| Script Executions | Historique des executions de scripts |
| Updates | Etat des mises a jour (systeme et logiciels) |
| Software Inventory | Inventaire des logiciels installes |
| Custom | Rapport personnalise, base sur les sections que vous choisissez vous-meme |

## Creer un nouveau rapport

Depuis la page Rapports, demarrez la creation d'un nouveau rapport et renseignez les elements suivants :

1. Le type de rapport (voir tableau ci-dessus).
2. Le **perimetre** (a quels appareils le rapport s'applique) :
   - **Entire tenant** : tous les appareils de votre organisation.
   - **Device group** : un groupe d'appareils precis.
   - **Specific device** : un seul appareil.
3. Si vous avez choisi un rapport de type Custom, les sections a inclure parmi : **Hardware**, **Software**, **Updates**, **Compliance**, **Script History**, **Network**.
4. Le **format d'export** : **PDF**, **CSV**, **Excel**, **HTML** ou **JSON**.
5. Le moment ou le rapport doit se generer, via le choix **Recurring (cron)** ou **Generate now** :
   - **Generate now** genere le rapport une seule fois, immediatement.
   - **Recurring (cron)** genere le rapport automatiquement de facon repetee. Des boutons de raccourci sont proposes pour les frequences les plus courantes : **Every hour**, **Every day at 2am**, **Every Monday at 9am**, **Every Sunday at midnight**, **Every 15 minutes**. Vous pouvez aussi saisir une expression personnalisee et preciser un fuseau horaire.
6. Validez pour creer le rapport.

## Generer un rapport a la demande

Meme pour un rapport configure en mode recurrent, vous pouvez forcer une generation immediate a tout moment en cliquant sur le bouton **Generate** (icone de lecture) a cote du rapport concerne, sans attendre sa prochaine execution planifiee.

## Consulter et telecharger les resultats

Chaque rapport conserve l'historique de ses generations, avec pour chaque fichier :

- Un statut : **Generating** (en cours), **Ready** (pret a telecharger) ou **Error** (echec de generation).
- La taille du fichier et le nombre de lignes de donnees.
- La date de generation.
- Un bouton **Download** disponible des que le statut passe a **Ready**.

## Modifier ou supprimer un rapport

Depuis la liste des rapports :

- Cliquez sur l'icone d'edition pour changer le type, le perimetre, les sections, le format ou la planification.
- Cliquez sur l'icone de suppression pour retirer definitivement un rapport ; une confirmation vous sera demandee avant suppression.