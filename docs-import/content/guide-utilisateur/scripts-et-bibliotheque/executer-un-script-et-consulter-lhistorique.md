Ce guide explique comment lancer un script a la demande sur vos appareils, et comment retrouver le resultat de ses executions.

## Lancer un script depuis l'onglet Run

L'onglet **Run** (dans **Automations**) permet d'executer un script immediatement, sans passer par une planification ni un scenario.

1. Allez dans **Automations > Run**
2. Dans le champ **Script**, choisissez le script a executer (**Select a script...**)
3. Dans la section **Target**, choisissez la cible :
   - **All devices** pour viser tous les appareils
   - **By group** pour viser un ou plusieurs groupes precis, a selectionner dans l'arbre **Groups** (selection multiple possible)
4. Cliquez sur **Execute now**

Pendant l'envoi, le bouton affiche **Running...**. Une fois la commande transmise, un message de confirmation s'affiche :

> Script dispatched to N device(s). Check the History tab for results.

Le resultat detaille de l'execution (succes, erreurs, sorties du script) n'apparait pas immediatement sur cette page : il faut consulter l'onglet **History** pour le voir.

## Lancer un script depuis la fiche d'un appareil

Il est egalement possible d'executer un script sur **un seul appareil**, directement depuis sa fiche :

1. Ouvrez la fiche de l'appareil concerne
2. Reperez la section d'execution de script sur la fiche
3. Selectionnez le script a lancer
4. Cliquez sur le bouton d'execution

Dans ce cas, le script est envoye uniquement a cet appareil, sans passer par la selection de groupe.

## Consulter l'historique des executions

L'onglet **History** (dans **Automations**) liste tous les lots d'execution de scripts (Â« batches Â»), qu'ils aient ete lances manuellement ou par une planification (**Schedule**).

Pour chaque lot d'execution, vous retrouvez :

- Des compteurs de statut : succes, echec, en cours, en attente
- Un badge indiquant l'origine du declenchement : **Schedule** ou **Manual** (avec, dans ce dernier cas, le nom de l'utilisateur qui a lance l'execution)
- Le detail par appareil : nom de la machine, type de systeme d'exploitation, statut, code de sortie
- Les horodatages : moment du declenchement, du demarrage et de la fin d'execution

## Consulter la sortie d'un script (stdout / stderr)

Pour chaque appareil d'un lot d'execution, vous pouvez consulter le detail de ce que le script a produit :

- La sortie standard (**stdout**)
- La sortie d'erreur (**stderr**)

Cette sortie peut etre affichee **en plein ecran** pour en faciliter la lecture, ce qui est particulierement utile pour analyser un script qui a echoue ou pour verifier le resultat exact d'une verification (**Check**).