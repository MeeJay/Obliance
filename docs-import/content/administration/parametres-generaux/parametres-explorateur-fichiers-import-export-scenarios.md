Trois sections de la page Paramètres, réservées aux administrateurs, couvrent respectivement le comportement de l'explorateur de fichiers distant, l'import/export global de l'installation, et la sauvegarde/restauration en masse des scénarios.

## Section « File explorer — editable extensions »

Cette section contrôle quelles extensions de fichiers s'ouvrent **directement dans l'éditeur de texte intégré** de l'explorateur de fichiers d'un agent, plutôt que de déclencher un téléchargement du fichier.

- Le réglage est **transverse à tous les tenants** de l'installation (pas de surcharge par tenant).
- Les extensions sont affichées sous forme de puces (chips) supprimables individuellement.
- Ajout d'extensions : saisie libre, plusieurs extensions séparées par une virgule ou un espace.
- Bouton **Reset to defaults** : restaure la liste d'extensions par défaut fournie avec Obliance (un compteur indique le nombre d'extensions concernées par la remise à zéro).
- Bouton **Save** pour valider les changements.

Typiquement utilisé pour ajouter des extensions de configuration ou de script propres à l'environnement (ex. fichiers `.conf`, `.ini` maison) que l'on souhaite pouvoir éditer en un clic depuis l'explorateur de fichiers distant, sans repasser par un téléchargement/upload manuel.

## Section « Import / Export »

Cette section intègre directement la page **Import/Export** (habituellement accessible depuis le menu admin *Import/Export*) dans un encart de la page Paramètres, pour un accès rapide sans changer de page.

## Section « Scénarios — bulk export / import »

Permet de sauvegarder ou restaurer **l'ensemble des scénarios du tenant courant** en une seule opération, en complément de l'export unitaire disponible scénario par scénario (icône de téléchargement sur chaque ligne, depuis la page Automations → Scénarios).

Deux options d'export sont proposées :

| Option | Contenu du fichier JSON |
|---|---|
| **Export all (lean)** | Structure des scénarios (étapes, déclencheurs, conditions) sans le contenu des scripts associés |
| **Export all (with scripts)** | Structure complète des scénarios avec le contenu des scripts embarqué dans le même fichier |

L'import se fait via **Import bulk JSON** : sélection d'un fichier JSON exporté précédemment, puis import en masse. Un **rapport ligne par ligne** est affiché à l'issue de l'opération, indiquant pour chaque scénario du fichier s'il a été importé avec succès ou en échec (avec le motif d'échec le cas échéant).

### Cas d'usage typiques

- **Sauvegarde avant une refonte** : exporter en « with scripts » avant de modifier en profondeur un scénario complexe, pour pouvoir le restaurer tel quel en cas d'erreur.
- **Migration entre installations ou entre tenants** : exporter depuis l'installation ou le tenant source, puis importer sur la cible via cette même section.
- **Rédaction assistée par IA** : le format JSON exporté peut servir de modèle pour demander à un assistant IA de générer un nouveau scénario dans le même format, avant de l'importer via **Import bulk JSON**.

> Conserver les fichiers d'export dans un emplacement sûr en dehors d'Obliance (poste local, stockage partagé) : ils constituent la seule sauvegarde exploitable en cas de suppression accidentelle ou de restauration nécessaire d'un scénario.