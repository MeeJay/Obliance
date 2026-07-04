Ce chapitre explique comment retrouver, trier et organiser vos appareils dans Obliance.

## Ou trouver la liste des appareils

La liste de vos appareils est accessible depuis le menu **Appareils**. Si vous etes administrateur, vous pouvez egalement la retrouver dans le menu **Agents**, sous l'onglet **Agents** — c'est exactement le meme tableau, seules certaines actions supplementaires (suppression, desinstallation, transfert, filtres d'approbation) y sont visibles selon votre role.

La page est organisee en deux zones :

- a **gauche**, un panneau de **groupes** (repliable et redimensionnable a la souris) ;
- a **droite**, le **tableau des appareils** correspondant au groupe selectionne.

## Comprendre une ligne d'appareil

Chaque ligne du tableau affiche, de gauche a droite :

1. une case a cocher (visible en mode selection, ou en permanence pour les administrateurs) ;
2. une icone representant le systeme d'exploitation (Windows, macOS, Linux...) ;
3. le nom de l'appareil, suivi de ses **tags** (jusqu'a 2 affiches, puis un compteur "+n") ;
4. des icones d'etat : redemarrage en attente, mode confidentialite actif, mode Airgap actif, ou suspicion d'identifiant d'agent duplique (icone orange, infobulle "Duplicate agent ID suspected") ;
5. un badge orange **Legacy** si l'appareil utilise l'ancien agent (voir plus bas) ;
6. de petites barres de charge CPU / Memoire / Disque, et jusqu'a 3 indicateurs personnalises supplementaires ;
7. un badge de **statut de connexion** (voir tableau ci-dessous) ;
8. le delai depuis la derniere fois que l'appareil a ete vu en ligne ;
9. un bouton "oeil" pour ouvrir la fiche detaillee de l'appareil (un clic avec la molette de la souris l'ouvre dans un nouvel onglet).

Une **deuxieme ligne**, sous chaque appareil, peut afficher des informations complementaires configurables : adresse IP locale, IP publique, adresse MAC, systeme d'exploitation, version de l'agent (avec une pastille "MAJ" si une mise a jour est disponible), groupe, dernier utilisateur connecte, ville, date du dernier redemarrage, cycle de vie, garantie, tags. Cliquez sur **Colonnes** pour choisir les informations que vous voulez voir sur cette deuxieme ligne : votre choix est memorise pour les prochaines visites.

## Les statuts d'un appareil

| Badge | Signification |
|---|---|
| En ligne | L'appareil est connecte et fonctionne normalement |
| Attention | L'appareil signale un avertissement |
| Critique | L'appareil signale un probleme critique |
| Hors ligne | L'appareil ne repond plus |
| En attente | L'appareil vient de s'installer et attend une approbation |
| Maintenance | L'appareil est place en maintenance |
| Suspendu | L'appareil a ete suspendu |
| Desinstallation en cours | Une desinstallation de l'agent est en cours |
| Mise a jour | L'agent est en train de se mettre a jour |
| Erreur MAJ | La mise a jour de l'agent a echoue |

Deux badges supplementaires peuvent s'ajouter independamment du statut : **Refuse** (l'appareil a ete rejete lors de son approbation) et **Erreur planification** (une automatisation programmee a echoue sur cet appareil). Un badge **Mise a jour dispo** apparait aussi quand une nouvelle version de l'agent existe.

## Rechercher et filtrer

- La barre **Rechercher des appareils...** cherche a la fois dans le nom de la machine, le nom affiche, les adresses IP, l'adresse MAC, le dernier utilisateur, le systeme d'exploitation, la version de l'agent, la localisation, les tags, les notes et l'identifiant de l'appareil.
- Des filtres rapides (chips) permettent de filtrer par etat d'approbation : **Tous / Approuves / En attente / Refuses / Suspendus**.
- Des filtres supplementaires existent par version de systeme d'exploitation, par version precise (build), et par tags.
- Le mode **Selection** permet de cocher des appareils sans naviguer accidentellement vers leur fiche en cliquant dessus.

Si un groupe contient beaucoup d'appareils, l'affichage en arbre se limite a un nombre maximum de lignes a la fois ; un message "Affichage des X premiers sur Y" apparait avec un bouton pour en charger davantage.

## Les agents "Legacy"

Certaines machines anciennes (par exemple Windows Server 2008 R2) utilisent une version allegee de l'agent, reperable au badge orange **Legacy**. Ces appareils ne prennent pas en charge : la prise en main a distance (bureau/console), le partage d'ecran ObliReach, le controle de conformite logicielle, ni la mise a jour automatique de l'agent. Dans le tableau et sur la fiche de l'appareil, les boutons d'actions non prises en charge par un agent Legacy sont grises, avec une infobulle l'indiquant.

## Organiser vos appareils en groupes

Le panneau de gauche liste vos groupes sous forme d'arbre :

- **All Devices** represente la racine : tous les appareils. Vous pouvez y deposer un groupe pour le faire remonter au premier niveau.
- **Ungrouped** regroupe les appareils qui n'appartiennent a aucun groupe.
- Vous pouvez **glisser-deposer** un groupe pour le reordonner ou le rattacher a un autre groupe parent.
- Un bouton permet de **creer un nouveau groupe** directement depuis le panneau (nom + parent optionnel).
- L'icone crayon a cote d'un groupe ouvre ses parametres detailles.
- Un mini tableau de bord en haut du panneau resume l'etat de votre parc : nombre d'appareils en ligne, hors ligne, en avertissement et en critique.
- Une recherche permet de filtrer directement les groupes affiches.
- Le panneau peut etre redimensionne a la souris ou replie completement ; ces preferences sont memorisees.

Si votre compte a acces a plusieurs organisations en meme temps (vue "master"), les groupes sont regroupes visuellement par organisation, avec un en-tete bleu portant le nom de chacune.

## Ajouter un nouvel appareil

Le bouton **+Appareil** ouvre une fenetre qui genere, pour chaque cle d'installation disponible, la commande a executer sur la machine a proteger (Windows, macOS Apple Silicon, macOS Intel, Linux, FreeBSD), avec un bouton pour copier la commande directement.