Le mode confidentialite (Privacy mode) permet a l'utilisateur d'une machine de bloquer temporairement les interventions a distance sur son poste. Cette page explique son fonctionnement et comment un administrateur peut, dans certains cas, continuer a intervenir malgre tout.

## Ce que bloque le mode confidentialite

Quand le mode confidentialite est actif sur un appareil, l'agent installe sur la machine refuse toutes les commandes suivantes venant d'Obliance :

- L'execution de scripts a distance.
- L'ouverture d'une session de prise en main a distance (Reach), ainsi que les sessions CMD, PowerShell ou SSH.
- La consultation des sessions utilisateur et des processus en cours, et l'arret de processus.
- La consultation et la manipulation des fichiers (parcourir les dossiers, creer, renommer, supprimer, telecharger ou envoyer des fichiers).

De plus, le service qui permet le streaming d'ecran (utilise par Reach) est arrete tant que le mode confidentialite est actif. C'est pourquoi, dans la fiche de l'appareil, le bouton **Chat** devient indisponible avec le message "Chat is unavailable while privacy mode is active (ObliReach service is stopped)".

## Qui peut activer ou desactiver le mode confidentialite

- **L'utilisateur de la machine** peut activer ou desactiver le mode confidentialite localement, directement depuis l'icone d'Obliance dans la barre d'etat (barre des taches) de son ordinateur.
- **Un administrateur** peut aussi desactiver le mode confidentialite a distance depuis la fiche de l'appareil dans Obliance, sous reserve qu'un mot de passe de confidentialite ait ete configure sur l'appareil (voir ci-dessous).

## Le mot de passe de confidentialite (Privacy password)

Pour permettre a un administrateur d'intervenir malgre le mode confidentialite, un mot de passe de confidentialite optionnel peut etre defini sur l'appareil, depuis sa fiche dans Obliance. Il est possible de le definir, le modifier ou le supprimer a tout moment.

Ce mot de passe est stocke uniquement sur la machine elle-meme : le serveur Obliance ne connait jamais sa valeur, il sait seulement si un mot de passe a ete defini ou non.

## Deverrouiller une fonctionnalite precise a distance

Si un mot de passe de confidentialite est defini, un administrateur peut deverrouiller temporairement une seule fonctionnalite (par exemple uniquement la prise en main a distance, ou uniquement l'execution de scripts) sans desactiver completement le mode confidentialite de l'utilisateur. Il suffit de saisir, quand cela est demande, le mot de passe defini sur la machine.

Ce deverrouillage :

- Dure 15 minutes, renouvelees a chaque action (fenetre glissante).
- Ne peut jamais depasser 2 heures au total, meme en cas d'usage continu.
- N'est pas conserve si le serveur Obliance redemarre entre-temps : il faut alors le refaire.
- S'applique uniquement a la fonctionnalite choisie, sur cet appareil precis — les autres fonctionnalites bloquees restent bloquees.

Les quatre familles de fonctionnalites qui peuvent etre deverrouillees individuellement sont : l'execution de scripts, la prise en main a distance (Reach, CMD, PowerShell, SSH), la consultation des sessions et processus, et la gestion des fichiers.

Une fois une fonctionnalite deverrouillee pendant que le mode confidentialite reste actif, une icone de cadenas ouvert (verte) apparait a cote du bouton de prise en main a distance, dans l'entete de la fiche de l'appareil, pour rappeler qu'un acces temporaire est en cours.

## Desactiver completement le mode confidentialite a distance

De la meme facon, si un mot de passe de confidentialite est defini, un administrateur peut demander la desactivation complete du mode confidentialite depuis la fiche de l'appareil, en saisissant le mot de passe defini sur la machine, sans attendre que l'utilisateur le fasse lui-meme.

## Si aucun mot de passe n'est defini

Si aucun mot de passe de confidentialite n'a ete configure sur l'appareil, l'acces distant reste totalement bloque tant que le mode confidentialite est actif. Dans ce cas, aucun deverrouillage a distance n'est possible : seul l'utilisateur de la machine peut desactiver le mode confidentialite localement, via l'icone dans sa barre d'etat.