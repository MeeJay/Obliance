Cette page couvre les derniÃ¨res sections de la page ParamÃ¨tres : la liste des extensions de fichiers Ã©ditables dans l'explorateur distant, les modÃ¨les de rÃ©ponse rapide du chat, et les fonctions d'export/import de configuration.

## File explorer â€” editable extensions

Cette section dÃ©finit la liste blanche des extensions de fichiers qui s'ouvrent directement dans l'Ã©diteur texte intÃ©grÃ© de l'explorateur de fichiers distant (utilisÃ© lors d'une prise en main d'un appareil), plutÃ´t que de forcer un tÃ©lÃ©chargement du fichier.

- La liste s'Ã©dite en texte libre, en sÃ©parant les extensions par une virgule ou un espace.
- La saisie est insensible Ã  la casse.
- Un bouton **Reset to defaults** permet de revenir instantanÃ©ment Ã  la liste par dÃ©faut fournie par l'application.
- Le texte de l'interface prÃ©cise explicitement que ce rÃ©glage **s'applique Ã  tous les tenants** de l'installation.

Ã€ utiliser avec discernement : ouvrir un type de fichier dans l'Ã©diteur intÃ©grÃ© plutÃ´t que de le tÃ©lÃ©charger facilite le dÃ©pannage rapide (fichiers de config, scripts, logs), mais Ã©largir excessivement cette liste peut exposer des formats de fichiers non prÃ©vus pour une Ã©dition en ligne.

Comme les autres rÃ©glages communs Ã  toute l'installation prÃ©sents sur cette page (SÃ©curitÃ©, Obligate SSO Gateway), l'enregistrement de cette liste peut Ãªtre soumis Ã  la politique de restriction d'actions dÃ©crite dans la page Â« Serveurs SMTP, sÃ©curitÃ© 2FA et connexion SSO Obligate Â» de ce chapitre.

## Quick Reply Templates

Cette section gÃ¨re des modÃ¨les de rÃ©ponses rapides et multilingues, utilisÃ©s par les opÃ©rateurs dans le panneau de chat lors d'Ã©changes avec les utilisateurs finaux (ex. pendant une session de prise en main Ã  distance).

- Le texte en **anglais est obligatoire** pour chaque modÃ¨le.
- 17 autres langues sont optionnelles : franÃ§ais, espagnol, allemand, portugais, chinois, japonais, corÃ©en, russe, arabe, italien, nÃ©erlandais, polonais, turc, suÃ©dois, danois, tchÃ¨que, ukrainien (soit 18 langues au total avec l'anglais).
- Un modÃ¨le sans traduction dans une langue donnÃ©e retombe sur le texte anglais lors de son utilisation.
- Un nouveau modÃ¨le peut Ãªtre crÃ©Ã© directement depuis cette section.

### PortÃ©e

Les modÃ¨les de rÃ©ponse rapide sont **propres Ã  chaque tenant** â€” un modÃ¨le crÃ©Ã© sur un tenant n'apparaÃ®t pas pour les opÃ©rateurs d'un autre tenant.

## Import / Export

Cette section embarque la page dÃ©diÃ©e d'import/export de configuration, qui permet d'exporter et de rÃ©importer en JSON les objets suivants :

- Groupes de moniteurs
- Moniteurs
- RÃ©glages (settings)
- Canaux de notification
- Groupes d'agents
- Ã‰quipes (teams)
- Actions de remÃ©diation
- Liaisons de remÃ©diation (remediation bindings)

Ã€ l'import, en cas de conflit avec un objet existant (mÃªme identifiant ou mÃªme nom), trois stratÃ©gies de rÃ©solution sont proposÃ©es objet par objet :

| StratÃ©gie | Effet |
|---|---|
| Update | Ã‰crase l'objet existant avec la version importÃ©e |
| Copy | CrÃ©e un nouvel objet en doublon, l'original est conservÃ© tel quel |
| Skip | Ignore l'objet importÃ©, l'existant n'est pas modifiÃ© |

Cette fonction est particuliÃ¨rement utile pour dupliquer une configuration entre deux installations Obliance, ou pour restaurer un jeu de rÃ©glages aprÃ¨s une erreur de manipulation.

## Scenarios â€” bulk export / import

Tout en bas de la page ParamÃ¨tres se trouve une section distincte, dÃ©diÃ©e exclusivement aux scÃ©narios d'automatisation.

Elle propose deux faÃ§ons d'exporter en un seul fichier JSON tous les scÃ©narios du tenant courant, ainsi qu'une faÃ§on de rÃ©importer un tel fichier :

- **Export Â« lean Â»** â€” sans les scripts associÃ©s (juste les rÃ©fÃ©rences).
- **Export avec scripts embarquÃ©s** â€” mÃªme export, mais avec le contenu des scripts intÃ©grÃ© directement dans le fichier, ce qui le rend autonome (utile pour une sauvegarde complÃ¨te ou un transfert vers une autre installation qui n'a pas les mÃªmes scripts en bibliothÃ¨que).
- **Import en masse** â€” rÃ©importe un tel fichier. La stratÃ©gie par dÃ©faut en cas de conflit sur un script est de l'ignorer (skip) plutÃ´t que de l'Ã©craser.

### Ã€ ne pas confondre

Cette fonction d'export/import **en masse** (tous les scÃ©narios du tenant d'un coup) est distincte de l'export/import **individuel** d'un scÃ©nario, qui se trouve sur la page **Automations â†’ Scenarios**, directement sur la fiche de chaque scÃ©nario. Utilisez la fonction de cette page ParamÃ¨tres pour une sauvegarde globale ou une migration complÃ¨te entre installations ; utilisez l'export individuel depuis Automations pour partager un seul scÃ©nario ou en confier le JSON Ã  un tiers (par exemple pour demander Ã  une IA de le modifier ou d'en gÃ©nÃ©rer un nouveau sur le mÃªme modÃ¨le).