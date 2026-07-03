En complement de la prise en main visuelle avec Reach, il est possible d'ouvrir une session en ligne de commande directement sur un appareil, sans passer par l'affichage graphique.

## Ou trouver cette fonction

Sur la fiche de l'appareil, dans la section **Start Remote Session**, plusieurs protocoles sont proposes selon le systeme d'exploitation de l'appareil :

| Systeme | Protocoles disponibles |
|---|---|
| Windows | Reach, CMD, PowerShell |
| macOS | Reach, SSH |
| Linux | SSH |

## Ouvrir une session Windows (CMD ou PowerShell)

1. Cliquez sur **CMD** ou **PowerShell** dans la fiche de l'appareil.
2. Une fenetre **CMD/PowerShell â€” Choose Context** s'ouvre pour choisir dans quel contexte la commande va s'executer :
   - **SYSTEM â€” Run as NT AUTHORITY\\SYSTEM** : execution avec les droits systeme les plus eleves, independamment de toute session utilisateur ouverte.
   - Une session utilisateur Windows active ou deconnectee, affichee sous la forme domaine\\utilisateur avec son etat (active ou deconnectee). Choisir cette option execute les commandes dans le contexte de cet utilisateur precis.
3. Une fois le contexte choisi, un terminal s'ouvre et se connecte a la machine distante (le delai d'etablissement de la connexion est de 60 secondes maximum avant echec).

## Ouvrir une session SSH (macOS / Linux)

1. Cliquez sur **SSH** dans la fiche de l'appareil.
2. Un terminal SSH s'ouvre et se connecte directement a la machine distante.

## Utiliser le terminal

Chaque session en ligne de commande s'ouvre dans un terminal qui accepte la saisie clavier classique. Un panneau de touches virtuelles est disponible pour envoyer des touches speciales qui seraient difficiles a saisir depuis certains claviers ou navigateurs (par exemple des touches de controle ou de fonction).

## Plusieurs sessions en parallele

Toutes les sessions CMD, PowerShell et SSH ouvertes s'affichent dans un panneau global sous forme d'onglets, distinct de la fenetre plein ecran utilisee par Reach. Cela permet de garder plusieurs terminaux ouverts en meme temps sur un ou plusieurs appareils, et de naviguer entre eux sans perdre la connexion.

## Fermer une session

Fermez l'onglet correspondant dans le panneau de sessions, ou utilisez la commande de deconnexion du terminal, pour mettre fin proprement a la session.

## A savoir

Un protocole **RDP** (Remote Desktop Protocol, propre a Windows) est visible dans certains ecrans de suivi des sessions (par exemple dans **Supervision > Sessions distantes**), mais aucun bouton de demarrage de session RDP n'est actuellement propose depuis la fiche d'un appareil : les options reellement disponibles pour demarrer une session restent Reach, CMD et PowerShell (Windows) ou SSH (macOS et Linux).