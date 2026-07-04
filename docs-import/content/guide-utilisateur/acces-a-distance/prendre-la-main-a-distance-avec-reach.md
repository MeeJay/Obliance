Cette page explique comment ouvrir une session de prise en main a distance sur un appareil et utiliser les outils disponibles pendant la session.

## Demarrer une session

1. Ouvrez la fiche de l'appareil concerne.
2. Dans la section **Start Remote Session**, cliquez sur le bouton **Reach**.
3. Une fenetre de visualisation s'ouvre et affiche l'ecran de la machine distante en temps reel (image et, si disponible, le son).

Pendant la connexion, la barre d'outils du visualiseur affiche l'un des statuts suivants :

| Statut | Signification |
|---|---|
| Connecting... | Etablissement de la connexion en cours |
| Waiting... | La commande de reveil a ete envoyee a l'appareil ; l'agent installe sur la machine doit se connecter dans les 30 secondes |
| Streaming | La session est active ; la resolution, le nombre d'images par seconde, le codec video et le debit sont affiches |
| Reconnecting... | Une coupure a ete detectee (par exemple lors d'un changement de session Windows, comme le passage de l'ecran de connexion a la session d'un utilisateur apres identification) ; le systeme retente automatiquement la connexion jusqu'a 5 fois, toutes les 2 secondes |
| Disconnected | La session est terminee |
| Error | Une erreur est survenue ; un message explicatif s'affiche avec un bouton pour fermer la fenetre |

## Utiliser la souris et le clavier

Une fois en statut **Streaming**, vous pilotez directement la machine distante :

- Les mouvements de souris, les clics et la molette sont transmis en direct.
- La saisie clavier est transmise a la machine distante.
- **Ctrl+V** envoie le contenu de votre presse-papier local vers la machine distante.
- **Ctrl+C** recupere le contenu du presse-papier de la machine distante vers votre presse-papier local.

## Envoyer des combinaisons speciales

Certaines combinaisons de touches sont interceptees par le navigateur et ne peuvent pas etre transmises normalement au clavier de la machine distante. Le visualiseur propose deux outils dedies :

- Le bouton **Ctrl+Alt+Del** envoie directement cette combinaison a la machine distante (utile pour deverrouiller un poste Windows ou ouvrir le gestionnaire de securite).
- Le menu **System keys** regroupe des combinaisons non interceptables par le navigateur, a choisir dans une liste :
  - Win, Win+D, Win+E, Win+R, Win+I, Win+L, Win+Tab, Win+Haut, Win+Bas
  - Alt+Tab, Alt+F4
  - Ctrl+Shift+Echap (ouvre le Gestionnaire des taches), Ctrl+Echap
  - Echap, Impr ecran, touche Menu, Pause

## Ecrans multiples

Si la machine distante possede plusieurs moniteurs, une mini-carte cliquable apparait dans le visualiseur : cliquez sur le moniteur souhaite pour basculer l'affichage dessus.

## Changer la qualite video

Le visualiseur permet de changer de codec video en cours de session (H.264, H.265, VP9, AV1 ou JPEG) selon la fluidite ou la qualite d'image souhaitee. Cette fonction necessite un navigateur recent (Chrome/Edge 94 ou superieur, Firefox 130 ou superieur) ; sur un navigateur trop ancien, un message d'erreur indique que le decodage video n'est pas disponible.

## Bloquer la saisie de l'utilisateur distant

Le bouton **Block** (qui devient **Blocked** avec une icone de cadenas une fois active) empeche l'utilisateur present physiquement devant la machine distante d'utiliser sa souris et son clavier pendant que vous intervenez a distance. Cela evite les conflits de manipulation pendant une operation de support.

## Capturer et enregistrer la session

- Un bouton de capture d'ecran telecharge une image PNG de l'ecran distant a l'instant T.
- Le bouton **Record** demarre un enregistrement video de la session ; cliquer sur **Stop** l'arrete et telecharge un fichier video (.webm) de l'enregistrement.

## Autres actions disponibles

- **Plein ecran** : bascule le visualiseur en plein ecran.
- **Chat** : ouvre une fenetre de discussion avec l'utilisateur present sur la machine distante.
- Coupure/activation du son distant, si le flux audio est disponible.
- **Disconnect** : ferme proprement la session de prise en main a distance.