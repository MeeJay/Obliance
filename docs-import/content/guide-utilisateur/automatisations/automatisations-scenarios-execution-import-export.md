# ExÃ©cuter, importer et suivre un scÃ©nario

Une fois un scÃ©nario construit, il peut Ãªtre dÃ©clenchÃ© manuellement, importÃ©/exportÃ© au format fichier, et suivi dans le temps via son historique.

## Lancer un scÃ©nario manuellement

Si le graphe d'un scÃ©nario contient un dÃ©clencheur **Manual**, un bouton de lecture (**Trigger now**) apparaÃ®t sur sa carte. En cliquant dessus :

1. Une fenÃªtre de sÃ©lection des appareils s'ouvre.
2. Recherchez les appareils souhaitÃ©s, ou cliquez sur **Select all** pour tous les sÃ©lectionner.
3. Confirmez pour lancer l'exÃ©cution sur les appareils choisis.

## Suivre une exÃ©cution en cours

Tant qu'un scÃ©nario a des exÃ©cutions actives, sa carte affiche un badge rouge indiquant le nombre de runs en cours. Un bouton **Stop** permet d'annuler immÃ©diatement toutes les exÃ©cutions actives de ce scÃ©nario.

Pour consulter le dÃ©tail des exÃ©cutions passÃ©es ou en cours, utilisez le bouton **History**, qui ouvre l'historique complet des runs du scÃ©nario.

## Importer un scÃ©nario

Trois faÃ§ons d'obtenir un nouveau scÃ©nario sans le construire entiÃ¨rement Ã  la main :

### Depuis un modÃ¨le prÃªt Ã  l'emploi

Le bouton **Import from template** propose 12 modÃ¨les prÃ©-intÃ©grÃ©s :

| ModÃ¨le | Ce qu'il fait |
|---|---|
| Deploy Obliview Agent - Windows / - Linux/macOS | Installe l'agent de visualisation distante Obliview et vÃ©rifie que le service tourne |
| Deploy Oblimap Agent - Windows / - Linux/macOS | Installe l'agent de dÃ©couverte rÃ©seau Oblimap, vÃ©rifie le service et lance une premiÃ¨re sonde rÃ©seau |
| Deploy Obliguard Agent - Windows / - Linux/macOS | Installe l'agent de protection de poste Obliguard, vÃ©rifie le service et la politique de sÃ©curitÃ© appliquÃ©e |
| Demo - Chrome Kiosk Mode | Lance Chrome en mode kiosque Ã  l'ouverture de session et s'assure qu'il reste actif |
| Demo - Active Directory Domain Join | Rejoint un domaine Active Directory aprÃ¨s approbation de l'agent |
| Demo - Install Software via Winget | Installe un logiciel via Winget sur Windows |
| Demo - Linux SSH Hardening | DÃ©sactive la connexion root et l'authentification par mot de passe en SSH |
| Demo - Force Windows Updates | Recherche et installe les mises Ã  jour Windows, redÃ©marre si nÃ©cessaire |
| Demo - Verify Backup Agent Running | VÃ©rifie qu'un agent de sauvegarde (type Veeam/Acronis) est installÃ© et actif â€” alerte uniquement, ne corrige pas |

La plupart de ces modÃ¨les utilisent un dÃ©clencheur **Manual**. Exceptions : "Demo - Chrome Kiosk Mode" se dÃ©clenche sur **Session login**, et "Demo - Active Directory Domain Join" se dÃ©clenche sur **Agent approved**.

### Depuis un fichier JSON

Le bouton **Import JSON** permet d'importer un scÃ©nario prÃ©alablement exportÃ© (le vÃ´tre ou celui d'un collÃ¨gue), ou gÃ©nÃ©rÃ© Ã  partir d'un modÃ¨le vierge rempli avec l'aide d'une IA. Si des scripts du fichier entrent en conflit avec des scripts dÃ©jÃ  existants (mÃªme identifiant), une Ã©tape de rÃ©solution des conflits est proposÃ©e avec trois choix possibles : ignorer, Ã©craser, ou crÃ©er en nouveau.

### Depuis un squelette vierge

Le bouton **Empty template** tÃ©lÃ©charge un fichier JSON vierge et commentÃ©, avec un exemple pour chaque type de nÅ“ud. Il est conÃ§u pour servir de base Ã  un brief donnÃ© Ã  une intelligence artificielle ("gÃ©nÃ¨re-moi un scÃ©nario qui..."), ou comme point de dÃ©part pour construire un scÃ©nario directement en Ã©ditant le fichier.

## Exporter un scÃ©nario

Depuis le menu d'un scÃ©nario existant, deux options d'export sont proposÃ©es :

- **Export (lean)** â€” export lÃ©ger qui rÃ©fÃ©rence les scripts utilisÃ©s par leur identifiant, sans inclure leur contenu (nÃ©cessite que ces scripts existent dÃ©jÃ  dans l'environnement cible)
- **Export with scripts** â€” export autonome qui embarque le contenu complet des scripts, utilisable pour migrer le scÃ©nario vers un autre environnement ou pour l'archiver avant une modification risquÃ©e

## Supprimer un scÃ©nario

La suppression d'un scÃ©nario demande une confirmation explicite ("Delete scenario "{nom du scÃ©nario}"?") avant d'Ãªtre dÃ©finitive.

## Lien avec les tÃ¢ches planifiÃ©es (schedules)

Dans l'onglet **Schedules** de la page Automations, une tÃ¢che planifiÃ©e configurÃ©e avec une vÃ©rification de rÃ©sultat (assert-pass) peut Ãªtre reliÃ©e Ã  un scÃ©nario : si la vÃ©rification Ã©choue, le scÃ©nario liÃ© se dÃ©clenche automatiquement (dÃ©clencheur **Schedule Failure**). Ce lien se configure directement depuis le formulaire de la tÃ¢che planifiÃ©e concernÃ©e.