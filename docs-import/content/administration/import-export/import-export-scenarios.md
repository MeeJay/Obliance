Chaque scenario d'automatisation peut etre exporte individuellement (ou en lot) sous forme de fichier JSON portable, puis reimporte sur le meme tenant, un autre tenant, ou une autre installation Obliance.

## Acces

Page **Automations**, onglet **Scenarios**.

## Exporter un scenario

Depuis le menu d'un scenario, deux options d'export sont proposees :

- **Export (lean)** : exporte uniquement la structure du scenario (etapes, conditions, declencheurs) avec des references vers les scripts utilises, sans le contenu des scripts eux-memes.
- **Export with scripts** : exporte la meme structure, en embarquant en plus le contenu complet de chaque script reference dans le fichier. Utile pour transferer un scenario vers une autre installation ou un autre tenant qui ne possede pas deja ces scripts.

Le fichier peut aussi inclure les planifications (schedules) liees au scenario, lorsque celui-ci est declenche en escalade apres l'echec d'un schedule, ou lorsqu'un declencheur du scenario reference directement un schedule.

## Exporter tous les scenarios (export en lot)

Un export en lot permet de recuperer en une seule fois l'ensemble des scenarios du tenant courant dans un unique fichier, pratique pour une sauvegarde complete avant une migration ou un changement majeur.

## Generer un scenario avec une IA

Un bouton dedie **Download an empty scenario JSON to share with an AI / colleague** permet de telecharger un squelette JSON vierge et commente, avec un exemple pour chaque type d'etape possible. Ce fichier est concu pour etre colle directement dans un prompt destine a une IA generative (ou transmis a un collegue) afin de lui faire generer un scenario complet a partir d'une description en langage naturel, que vous importerez ensuite tel quel.

## Importer un scenario

1. Depuis la page Scenarios, utilisez la fonction d'import du menu (avec ou sans scripts embarques selon le fichier fourni).
2. Selectionnez le fichier `.json` a importer.
3. Un premier passage analyse le fichier et affiche un **apercu des conflits** : la liste des scripts du fichier dont l'identifiant correspond deja a un script existant sur le tenant cible. Si aucun conflit n'est detecte, l'import peut se faire directement.
4. Pour chaque script en conflit, choisissez une resolution :

| Choix | Effet |
|---|---|
| **Skip** | Le script existant sur le tenant est conserve tel quel, la version du fichier est ignoree |
| **Overwrite** | Le contenu du script existant est ecrase par celui du fichier importe |
| **New** | Une copie du script est creee avec un nouvel identifiant, l'existant n'est pas touche |

5. Validez : l'ensemble du scenario (etapes, conditions, declencheurs, scripts selon les resolutions choisies) est cree en une seule operation.

### Import en lot

Si le fichier provient d'un export en lot (tous les scenarios d'un tenant), l'import applique le meme principe en deux passages, avec des resolutions de conflits partagees pour l'ensemble des scenarios du fichier plutot que scenario par scenario.

## Comportement apres import

Un scenario importe est **toujours cree en statut brouillon (draft)**, quel qu'ait ete son statut au moment de l'export (actif ou non). Cela evite qu'un scenario se declenche automatiquement sur le tenant cible avant que l'administrateur ne l'ait relu et active manuellement.

## Compatibilite entre versions de format

Le format d'export de scenario evolue au fil des versions du produit (identifie par un numero de version interne au fichier). Un fichier issu d'une version anterieure reste importable : Obliance le convertit automatiquement au format courant au moment de l'import, sans action manuelle necessaire de votre part. Vous pouvez donc conserver en archive d'anciens exports de scenarios sans crainte de ne plus pouvoir les reimporter apres une mise a jour d'Obliance.

> Build a lancer : aucun (documentation uniquement)