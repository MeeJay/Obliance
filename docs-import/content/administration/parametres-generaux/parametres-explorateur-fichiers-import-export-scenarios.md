Trois sections de la page ParamÃ¨tres, rÃ©servÃ©es aux administrateurs, couvrent respectivement le comportement de l'explorateur de fichiers distant, l'import/export global de l'installation, et la sauvegarde/restauration en masse des scÃ©narios.

## Section Â« File explorer â€” editable extensions Â»

Cette section contrÃ´le quelles extensions de fichiers s'ouvrent **directement dans l'Ã©diteur de texte intÃ©grÃ©** de l'explorateur de fichiers d'un agent, plutÃ´t que de dÃ©clencher un tÃ©lÃ©chargement du fichier.

- Le rÃ©glage est **transverse Ã  tous les tenants** de l'installation (pas de surcharge par tenant).
- Les extensions sont affichÃ©es sous forme de puces (chips) supprimables individuellement.
- Ajout d'extensions : saisie libre, plusieurs extensions sÃ©parÃ©es par une virgule ou un espace.
- Bouton **Reset to defaults** : restaure la liste d'extensions par dÃ©faut fournie avec Obliance (un compteur indique le nombre d'extensions concernÃ©es par la remise Ã  zÃ©ro).
- Bouton **Save** pour valider les changements.

Typiquement utilisÃ© pour ajouter des extensions de configuration ou de script propres Ã  l'environnement (ex. fichiers `.conf`, `.ini` maison) que l'on souhaite pouvoir Ã©diter en un clic depuis l'explorateur de fichiers distant, sans repasser par un tÃ©lÃ©chargement/upload manuel.

## Section Â« Import / Export Â»

Cette section intÃ¨gre directement la page **Import/Export** (habituellement accessible depuis le menu admin *Import/Export*) dans un encart de la page ParamÃ¨tres, pour un accÃ¨s rapide sans changer de page.

## Section Â« ScÃ©narios â€” bulk export / import Â»

Permet de sauvegarder ou restaurer **l'ensemble des scÃ©narios du tenant courant** en une seule opÃ©ration, en complÃ©ment de l'export unitaire disponible scÃ©nario par scÃ©nario (icÃ´ne de tÃ©lÃ©chargement sur chaque ligne, depuis la page Automations â†’ ScÃ©narios).

Deux options d'export sont proposÃ©es :

| Option | Contenu du fichier JSON |
|---|---|
| **Export all (lean)** | Structure des scÃ©narios (Ã©tapes, dÃ©clencheurs, conditions) sans le contenu des scripts associÃ©s |
| **Export all (with scripts)** | Structure complÃ¨te des scÃ©narios avec le contenu des scripts embarquÃ© dans le mÃªme fichier |

L'import se fait via **Import bulk JSON** : sÃ©lection d'un fichier JSON exportÃ© prÃ©cÃ©demment, puis import en masse. Un **rapport ligne par ligne** est affichÃ© Ã  l'issue de l'opÃ©ration, indiquant pour chaque scÃ©nario du fichier s'il a Ã©tÃ© importÃ© avec succÃ¨s ou en Ã©chec (avec le motif d'Ã©chec le cas Ã©chÃ©ant).

### Cas d'usage typiques

- **Sauvegarde avant une refonte** : exporter en Â« with scripts Â» avant de modifier en profondeur un scÃ©nario complexe, pour pouvoir le restaurer tel quel en cas d'erreur.
- **Migration entre installations ou entre tenants** : exporter depuis l'installation ou le tenant source, puis importer sur la cible via cette mÃªme section.
- **RÃ©daction assistÃ©e par IA** : le format JSON exportÃ© peut servir de modÃ¨le pour demander Ã  un assistant IA de gÃ©nÃ©rer un nouveau scÃ©nario dans le mÃªme format, avant de l'importer via **Import bulk JSON**.

> Conserver les fichiers d'export dans un emplacement sÃ»r en dehors d'Obliance (poste local, stockage partagÃ©) : ils constituent la seule sauvegarde exploitable en cas de suppression accidentelle ou de restauration nÃ©cessaire d'un scÃ©nario.