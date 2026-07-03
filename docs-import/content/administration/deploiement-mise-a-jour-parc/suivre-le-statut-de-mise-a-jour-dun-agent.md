Une fois une mise a jour d'agent declenchee, Obliance affiche un statut dedie qui permet de suivre la progression et de detecter une eventuelle anomalie, sans avoir a se connecter au poste.

## Les statuts affiches pendant et apres une mise a jour

| Statut | Signification | Rendu visuel |
|---|---|---|
| **Updating** | La mise a jour est en cours sur le poste (commande recue, installation en cours) | Badge bleu, point pulsant |
| **Update Error** | La mise a jour n'a pas abouti dans le delai attendu | Badge orange |

Ces deux statuts sont volontairement distincts des statuts habituels (En ligne / Hors ligne / etc.) afin de rendre visible immediatement qu'une operation de mise a jour est en cours ou a echoue, sans confondre cela avec une simple perte de connexion.

## Delai avant bascule en erreur

Si un device reste bloque en statut **Updating** pendant plus de **10 minutes** sans que sa version n'ait change, Obliance considere que la mise a jour a echoue et bascule automatiquement le device en **Update Error**. Cela evite qu'un poste reste indefiniment affiche comme "en cours de mise a jour" alors que l'operation s'est en realite arretee.

## Recuperation automatique

Si l'agent parvient malgre tout a se reconnecter au serveur (retablissement du canal de communication temps reel) alors qu'il etait reste bloque en **Updating**, **Update Error**, ou meme simplement **Hors ligne**, Obliance remet automatiquement son statut a **En ligne** des que la connexion est retablie. Il n'y a donc rien a faire manuellement dans ce cas : un device qui semblait bloque en erreur de mise a jour peut tres bien se "reparer" tout seul a la reconnexion suivante de l'agent.

Si le statut **Update Error** persiste, cela indique generalement un probleme reel sur le poste (installation qui ne s'est pas terminee, service qui ne redemarre pas, agent qui ne se reconnecte plus) qui necessite une verification locale.

## Ou surveiller cela au quotidien

### Sur le tableau de bord

La carte **En ligne** du tableau de bord affiche, sous un en-tete **"Dont :"**, des sous-compteurs dedies :

- **en MAJ** â€” nombre de devices actuellement en cours de mise a jour (statut Updating).
- **en erreur MAJ** â€” nombre de devices en erreur de mise a jour (statut Update Error), affiche uniquement s'il y en a au moins un.

Cela permet de reperer en un coup d'oeil, sans filtrer la liste des devices, si une campagne de mise a jour en cours se deroule normalement ou si des postes sont a surveiller.

### Sur la liste des devices

Les statuts **Updating** et **Update Error** sont visibles directement dans la colonne de statut de chaque device, avec les memes badges (bleu pulsant / orange) que sur la fiche detail.

A noter pour la logique des filtres de la liste : un device en **Updating** est compte comme "joignable/connecte" (regroupe avec En ligne, Warning, Critical), tandis qu'un device en **Update Error** est compte comme "non joignable/deconnecte" (regroupe avec Hors ligne). Cela a un impact si vous filtrez la liste sur les filtres globaux "connecte"/"deconnecte" plutot que sur les statuts precis.

## Bonnes pratiques de suivi

- Apres une mise a jour en lot, revenir sur le tableau de bord quelques minutes plus tard pour verifier que le compteur **en MAJ** redescend vers zero et qu'**en erreur MAJ** reste a zero.
- Un device reste en **Update Error** au-dela de quelques dizaines de minutes malgre plusieurs reconnexions reseau visibles ? C'est le signe qu'une intervention locale sur le poste est necessaire.
- Ne pas relancer une commande **Update agent** en boucle sur un device deja en erreur sans avoir verifie la cause localement : cela ne debloque pas une installation deja en echec.

â†’ Aucune action serveur ou client necessaire pour publier ce document.