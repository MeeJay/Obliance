La page **Paramètres** (menu admin *Paramètres*, `/settings`) regroupe la configuration globale de l'installation Obliance ; certaines sections n'apparaissent qu'aux comptes administrateurs.

## Accès à la page

- Menu latéral admin → **Paramètres**.
- La page est composée de plusieurs blocs indépendants, chacun avec son propre bouton d'enregistrement. Modifier un bloc n'affecte pas les autres.
- Certains blocs (About, Seuils métriques globaux, Quick Reply Templates, SMTP Servers, Security, Obligate SSO Gateway, File explorer, Import/Export, Scénarios — bulk export/import) sont réservés aux administrateurs. Le bloc **Default Monitor Settings** est visible par tout utilisateur ayant accès à la page.

## Section « About » — informations système

Réservée aux administrateurs, cette section affiche en lecture seule un état instantané de l'installation, utile pour le support et le diagnostic :

| Information | Détail |
|---|---|
| Versions | Server, Client, Agent, Oblireach, Node.js |
| Uptime | Durée depuis le dernier démarrage de l'instance |
| Environnement | Docker ou natif |
| Plateforme | Système d'exploitation du serveur |
| CPU | Nombre de cœurs, charge moyenne (load average 1/5/15 min) |
| Mémoire | Mémoire utilisée par le process (RSS, heap), mémoire système libre/totale |
| Base de données | Statut de connexion PostgreSQL (connecté / erreur) |

Cette section ne propose aucune action de configuration : c'est un tableau de bord de santé rapide, à consulter en priorité en cas de lenteur, d'erreur inattendue ou avant de contacter le support.

## Section « Default Monitor Settings » — réglages de supervision par défaut

Ce bloc affiche les valeurs par défaut appliquées à **tous les agents** de l'installation. Chacun de ces réglages peut ensuite être surchargé au niveau d'un groupe ou d'un appareil individuel (via le même type de panneau de réglages disponible sur les pages Groupe et Appareil) — la valeur définie ici sert de valeur de repli quand aucune surcharge locale n'existe.

| Réglage | Plage | Défaut | Rôle |
|---|---|---|---|
| Push Interval | 10 à 3600 s | 60 s | Fréquence à laquelle l'agent envoie ses métriques (CPU, mémoire, disque, statut) au serveur |
| Scan Interval | 0 à 86400 s | 3600 s | Fréquence des scans complets (inventaire matériel/logiciel, mises à jour, conformité). 0 = scans désactivés |
| Fast Poll Interval | 3 à 30 s | 5 s | Fréquence de vérification des commandes en attente lorsqu'une commande vient d'être envoyée à l'agent (mode réactif) |
| Max Missed Pushes | 1 à 20 | 3 | Nombre de push consécutifs manqués avant que l'agent bascule en statut « offline » |
| Notification Cooldown | 0 à 86400 s | 300 s | Délai minimum entre deux alertes répétées pour le même appareil, pour éviter le spam de notifications |

Trois réglages supplémentaires ne sont visibles **qu'au niveau global** (pas de surcharge par groupe/appareil possible) :

| Réglage | Plage | Défaut | Rôle |
|---|---|---|---|
| Inventory Retention | 7 à 365 jours | 90 jours | Durée de conservation des instantanés d'inventaire historiques |
| Auto-Approve Devices | booléen | Désactivé | Si activé, tout nouvel agent qui s'enregistre est approuvé automatiquement, sans validation manuelle |
| 2FA « Trust this IP » duration | 0 à 8760 h | 24 h | Durée pendant laquelle un choix « Trust this IP » lors de la double authentification évite de redemander un code. 0 = fonction désactivée, le code est toujours redemandé |

## Bonnes pratiques

- Diminuer le **Push Interval** augmente la réactivité du dashboard mais accroît la charge réseau et base de données sur un parc important ; à ajuster selon la taille du parc.
- Le **Scan Interval** à 0 désactive complètement les scans d'inventaire — à réserver à des cas très spécifiques (bande passante très contrainte), car cela prive l'inventaire et les politiques de conformité de données à jour.
- Activer **Auto-Approve Devices** est pratique en déploiement de masse contrôlé (même réseau, mêmes clés API dédiées), mais supprime le filtre manuel d'approbation : à n'activer que si l'accès aux clés API de déploiement est déjà strictement contrôlé.
- Passer **2FA Trust this IP duration** à 0 impose de resaisir un code 2FA à chaque connexion, y compris depuis un poste habituel — utile sur une installation à exigence de sécurité renforcée.