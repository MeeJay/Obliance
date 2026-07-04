# Supervision - Historique et rapports

Cette page couvre les onglets **History** et **Reports** de l'ecran Supervision, qui permettent respectivement de consulter l'activite passee sur le parc et de generer des rapports.

## Onglet History

L'onglet **History** regroupe deux sous-onglets.

### Tasks & Scripts

Ce sous-onglet reunit dans une seule liste tous les evenements d'execution : taches/commandes envoyees aux agents, executions de scripts, et mises a jour. Il permet de :

- Filtrer par type d'evenement (Tache/commande, Script, Mise a jour)
- Rechercher par texte libre
- Consulter les colonnes Date, Type, Action, Appareil, Statut, Utilisateur, Duree
- Naviguer par pages de 50 resultats

La liste se met a jour en temps reel a mesure que des commandes ou des executions changent d'etat.

Statuts possibles pour une tache ou un script : pending, sent, ack_running/running, success, failure/failed, timeout, cancelled, skipped, installed, approved, available.

### Scenarios

Ce sous-onglet liste les executions de scenarios (automations conditionnelles), avec les colonnes Date, Scenario, Appareil, Declencheur, Statut, Duree. Chaque ligne peut etre depliee pour voir le detail etape par etape : le code de sortie de chaque script de verification (check), de correction (resolve) et de nouvelle verification (recheck), ainsi que le message d'erreur en cas d'echec.

Statuts possibles pour un scenario : pending, running, success, failure, cancelled, timeout.

## Onglet Reports

L'onglet **Reports** permet de creer des rapports, soit generes immediatement (**Generate now**), soit planifies de facon recurrente (via une expression cron).

### Types de rapport disponibles

- Fleet Overview (vue d'ensemble du parc)
- Compliance (conformite)
- Script Executions (executions de scripts)
- Updates (mises a jour)
- Software Inventory (inventaire logiciel)
- Custom (personnalise)

### Formats d'export

PDF, CSV, Excel, HTML, JSON.

### Perimetre du rapport

Un rapport peut porter sur :

- L'ensemble du tenant (l'organisation courante)
- Un groupe d'appareils specifique
- Un appareil unique

### Sections incluables

Selon le type de rapport, vous pouvez choisir d'inclure : Hardware (materiel), Software (logiciels), Updates (mises a jour), Compliance (conformite), Script History (historique des scripts), Network (reseau).

### Recuperer un rapport

Chaque rapport genere peut produire plusieurs fichiers de sortie (par exemple un export par periode ou par format demande). Chaque sortie passe par les etats **Generating** (en cours de generation), **Ready** (prete au telechargement) ou **Error** (echec de generation). Une fois a l'etat Ready, le fichier est telechargeable directement depuis l'ecran.

## Bon a savoir

Les trois onglets de Supervision (Remote Sessions, History, Reports) partagent le meme droit d'acces cote equipe : si une equipe a le droit de consulter la supervision, elle voit les trois onglets ; sinon aucun.
