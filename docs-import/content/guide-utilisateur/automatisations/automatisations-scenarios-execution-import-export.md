# Exécuter, importer et suivre un scénario

Une fois un scénario construit, il peut être déclenché manuellement, importé/exporté au format fichier, et suivi dans le temps via son historique.

## Lancer un scénario manuellement

Si le graphe d'un scénario contient un déclencheur **Manual**, un bouton de lecture (**Trigger now**) apparaît sur sa carte. En cliquant dessus :

1. Une fenêtre de sélection des appareils s'ouvre.
2. Recherchez les appareils souhaités, ou cliquez sur **Select all** pour tous les sélectionner.
3. Confirmez pour lancer l'exécution sur les appareils choisis.

## Suivre une exécution en cours

Tant qu'un scénario a des exécutions actives, sa carte affiche un badge rouge indiquant le nombre de runs en cours. Un bouton **Stop** permet d'annuler immédiatement toutes les exécutions actives de ce scénario.

Pour consulter le détail des exécutions passées ou en cours, utilisez le bouton **History**, qui ouvre l'historique complet des runs du scénario.

## Importer un scénario

Trois façons d'obtenir un nouveau scénario sans le construire entièrement à la main :

### Depuis un modèle prêt à l'emploi

Le bouton **Import from template** propose 12 modèles pré-intégrés :

| Modèle | Ce qu'il fait |
|---|---|
| Deploy Obliview Agent - Windows / - Linux/macOS | Installe l'agent de visualisation distante Obliview et vérifie que le service tourne |
| Deploy Oblimap Agent - Windows / - Linux/macOS | Installe l'agent de découverte réseau Oblimap, vérifie le service et lance une première sonde réseau |
| Deploy Obliguard Agent - Windows / - Linux/macOS | Installe l'agent de protection de poste Obliguard, vérifie le service et la politique de sécurité appliquée |
| Demo - Chrome Kiosk Mode | Lance Chrome en mode kiosque à l'ouverture de session et s'assure qu'il reste actif |
| Demo - Active Directory Domain Join | Rejoint un domaine Active Directory après approbation de l'agent |
| Demo - Install Software via Winget | Installe un logiciel via Winget sur Windows |
| Demo - Linux SSH Hardening | Désactive la connexion root et l'authentification par mot de passe en SSH |
| Demo - Force Windows Updates | Recherche et installe les mises à jour Windows, redémarre si nécessaire |
| Demo - Verify Backup Agent Running | Vérifie qu'un agent de sauvegarde (type Veeam/Acronis) est installé et actif — alerte uniquement, ne corrige pas |

La plupart de ces modèles utilisent un déclencheur **Manual**. Exceptions : "Demo - Chrome Kiosk Mode" se déclenche sur **Session login**, et "Demo - Active Directory Domain Join" se déclenche sur **Agent approved**.

### Depuis un fichier JSON

Le bouton **Import JSON** permet d'importer un scénario préalablement exporté (le vôtre ou celui d'un collègue), ou généré à partir d'un modèle vierge rempli avec l'aide d'une IA. Si des scripts du fichier entrent en conflit avec des scripts déjà existants (même identifiant), une étape de résolution des conflits est proposée avec trois choix possibles : ignorer, écraser, ou créer en nouveau.

### Depuis un squelette vierge

Le bouton **Empty template** télécharge un fichier JSON vierge et commenté, avec un exemple pour chaque type de nœud. Il est conçu pour servir de base à un brief donné à une intelligence artificielle ("génère-moi un scénario qui..."), ou comme point de départ pour construire un scénario directement en éditant le fichier.

## Exporter un scénario

Depuis le menu d'un scénario existant, deux options d'export sont proposées :

- **Export (lean)** — export léger qui référence les scripts utilisés par leur identifiant, sans inclure leur contenu (nécessite que ces scripts existent déjà dans l'environnement cible)
- **Export with scripts** — export autonome qui embarque le contenu complet des scripts, utilisable pour migrer le scénario vers un autre environnement ou pour l'archiver avant une modification risquée

## Supprimer un scénario

La suppression d'un scénario demande une confirmation explicite ("Delete scenario "{nom du scénario}"?") avant d'être définitive.

## Lien avec les tâches planifiées (schedules)

Dans l'onglet **Schedules** de la page Automations, une tâche planifiée configurée avec une vérification de résultat (assert-pass) peut être reliée à un scénario : si la vérification échoue, le scénario lié se déclenche automatiquement (déclencheur **Schedule Failure**). Ce lien se configure directement depuis le formulaire de la tâche planifiée concernée.