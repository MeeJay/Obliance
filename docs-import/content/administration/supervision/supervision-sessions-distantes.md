# Supervision - Sessions distantes

Cette page explique comment ouvrir et suivre une prise en main a distance d'un appareil depuis l'interface d'administration Obliance.

## Acceder a l'ecran

Depuis le menu admin, ouvrez **Supervision**, puis l'onglet **Remote Sessions**. Cet onglet fait partie d'un ecran a trois onglets (Remote Sessions / History / Reports) ; les administrateurs voient toujours les trois. Un utilisateur non-administrateur ne voit que les onglets pour lesquels son equipe dispose du droit correspondant ; s'il n'a aucun droit, il est redirige vers le tableau de bord.

## Demarrer une nouvelle session

1. Depuis l'onglet **Remote Sessions**, recherchez l'appareil cible par nom d'hote ou par adresse IP.
2. Choisissez le protocole de connexion :

| Protocole | Usage |
|---|---|
| Oblireach | Diffusion d'ecran native, recommandee. Non disponible sur Linux. |
| RDP | Bureau a distance Windows. |
| SSH | Acces ligne de commande (Linux/macOS/Windows avec serveur SSH). |
| CMD | Invite de commandes distante. |
| PowerShell | Console PowerShell distante. |
| VM Console | Console d'une machine virtuelle Hyper-V (via FreeRDP). |

3. Renseignez si besoin le champ **Notes (optional)** : un texte libre utile pour tracer la raison de l'acces (numero de ticket, incident, etc.).
4. Lancez la session.

## Suivre les sessions actives

L'onglet **Remote Sessions** comporte un sous-onglet **Active Sessions** qui liste en temps reel toutes les sessions en cours, avec un badge indiquant le nombre de sessions actives. La liste se met a jour automatiquement (sans rechargement de page) des qu'une session change d'etat.

Une session distante peut passer par les etats suivants :

- **waiting** - en attente de connexion de l'agent
- **connecting** - connexion en cours d'etablissement
- **active** - session en cours
- **closed** - fermee normalement
- **failed** - echec de connexion
- **timeout** - delai depasse
- **expired** - session expiree

Pour une session Oblireach active, un bouton ouvre le visualiseur d'ecran en fenetre modale : vous voyez l'ecran de l'appareil en direct et pouvez le piloter. Fermer cette fenetre met fin a la session cote serveur.

## Historique des sessions

Le sous-onglet **History** (a l'interieur de Remote Sessions) liste les sessions passees avec les colonnes suivantes : Appareil, Protocole, Utilisateur, Date de debut, Duree, Statut.

## Tracabilite

Chaque ouverture et chaque fin de session distante est enregistree dans le journal d'audit de l'installation (voir la page dediee a l'audit), avec le protocole utilise et l'utilisateur a l'origine de l'action. Cela permet de retrouver a posteriori qui a pris la main sur quel appareil, quand, et par quel moyen.
