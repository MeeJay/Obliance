Ce guide explique comment creer un nouveau script, modifier ses reglages, le dupliquer ou le supprimer depuis la bibliotheque de scripts.

## Creer un nouveau script

1. Allez dans **Automations > Scripts**
2. Cliquez sur **New Script**
3. Renseignez les champs du formulaire (voir tableau ci-dessous)
4. Cliquez sur **Save** pour enregistrer, ou **Cancel** pour abandonner

Si vous n'avez encore selectionne ni cree aucun script, la zone de droite affiche le message **« Select a script or create a new one »**.

## Modifier un script existant

1. Cliquez sur un script dans la liste pour le selectionner
2. Cliquez sur **Edit**
3. Modifiez les champs necessaires
4. Cliquez sur **Save**

## Les champs du formulaire

| Champ | Description |
|---|---|
| **Name \*** | Nom du script (obligatoire) |
| **Platform** | Plateforme ciblee : Windows, macOS, Linux, FreeBSD ou toutes |
| **Runtime** | Langage d'execution (PowerShell, Bash, Python, etc.) |
| **Timeout (seconds)** | Duree maximale (en secondes) avant que l'execution soit consideree comme bloquee et interrompue |
| **Expected exit code** | Code de sortie attendu (par defaut 0). L'execution n'est marquee comme reussie par l'agent que si le script se termine avec exactement ce code |
| **Run As** | Contexte d'execution sur la machine : **System** ou **User** |
| **Purpose** | Type du script : Check, Resolve, Execute, Compliance ou Custom Metric |
| **Category** | Categorie sous laquelle le script apparaitra dans la liste (tiroirs repliables) |
| **Parent script (optional)** | Script parent auquel rattacher celui-ci, ou **« — No parent (top level) — »** pour ne pas en definir |
| **Tags (comma-separated)** | Mots-cles libres separes par des virgules, utiles pour la recherche et le tri |
| **Available in Reach** | Case a cocher — « show this script in the Oblireach desktop client ». Cochee, elle rend ce script visible et lancable depuis le client de bureau Oblireach |

Le contenu du script lui-meme (le code) se saisit egalement dans ce formulaire, dans la zone prevue a cet effet, selon le langage choisi dans **Runtime**.

## Dupliquer un script (Clone)

Pour partir d'un script existant (y compris un script **Built-in**, qui ne peut pas etre modifie ni supprime directement) :

1. Selectionnez le script dans la liste
2. Cliquez sur **Clone**

Une copie du script est creee ; vous pouvez ensuite l'editer librement comme n'importe quel script que vous avez cree vous-meme.

## Supprimer un script

1. Selectionnez le script dans la liste
2. Cliquez sur **Delete**

Le bouton **Delete** n'est pas disponible pour les scripts **Built-in** — ceux-ci ne peuvent etre supprimes, seulement clones.

## Bon a savoir avant de supprimer un script

Avant de supprimer un script, verifiez son badge d'usage dans la liste :

- **Unused** signifie qu'il n'est utilise dans aucun scenario ni aucune planification : la suppression est sans risque
- Un compteur du type « 2 scenario(s) / 1 schedule(s) » signifie que le script est activement utilise ailleurs dans Obliance : sa suppression impactera ces scenarios et planifications