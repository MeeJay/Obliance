La page **ParamÃ¨tres** (menu admin *ParamÃ¨tres*, `/settings`) regroupe la configuration globale de l'installation Obliance ; certaines sections n'apparaissent qu'aux comptes administrateurs.

## AccÃ¨s Ã  la page

- Menu latÃ©ral admin â†’ **ParamÃ¨tres**.
- La page est composÃ©e de plusieurs blocs indÃ©pendants, chacun avec son propre bouton d'enregistrement. Modifier un bloc n'affecte pas les autres.
- Certains blocs (About, Seuils mÃ©triques globaux, Quick Reply Templates, SMTP Servers, Security, Obligate SSO Gateway, File explorer, Import/Export, ScÃ©narios â€” bulk export/import) sont rÃ©servÃ©s aux administrateurs. Le bloc **Default Monitor Settings** est visible par tout utilisateur ayant accÃ¨s Ã  la page.

## Section Â« About Â» â€” informations systÃ¨me

RÃ©servÃ©e aux administrateurs, cette section affiche en lecture seule un Ã©tat instantanÃ© de l'installation, utile pour le support et le diagnostic :

| Information | DÃ©tail |
|---|---|
| Versions | Server, Client, Agent, Oblireach, Node.js |
| Uptime | DurÃ©e depuis le dernier dÃ©marrage de l'instance |
| Environnement | Docker ou natif |
| Plateforme | SystÃ¨me d'exploitation du serveur |
| CPU | Nombre de cÅ“urs, charge moyenne (load average 1/5/15 min) |
| MÃ©moire | MÃ©moire utilisÃ©e par le process (RSS, heap), mÃ©moire systÃ¨me libre/totale |
| Base de donnÃ©es | Statut de connexion PostgreSQL (connectÃ© / erreur) |

Cette section ne propose aucune action de configuration : c'est un tableau de bord de santÃ© rapide, Ã  consulter en prioritÃ© en cas de lenteur, d'erreur inattendue ou avant de contacter le support.

## Section Â« Default Monitor Settings Â» â€” rÃ©glages de supervision par dÃ©faut

Ce bloc affiche les valeurs par dÃ©faut appliquÃ©es Ã  **tous les agents** de l'installation. Chacun de ces rÃ©glages peut ensuite Ãªtre surchargÃ© au niveau d'un groupe ou d'un appareil individuel (via le mÃªme type de panneau de rÃ©glages disponible sur les pages Groupe et Appareil) â€” la valeur dÃ©finie ici sert de valeur de repli quand aucune surcharge locale n'existe.

| RÃ©glage | Plage | DÃ©faut | RÃ´le |
|---|---|---|---|
| Push Interval | 10 Ã  3600 s | 60 s | FrÃ©quence Ã  laquelle l'agent envoie ses mÃ©triques (CPU, mÃ©moire, disque, statut) au serveur |
| Scan Interval | 0 Ã  86400 s | 3600 s | FrÃ©quence des scans complets (inventaire matÃ©riel/logiciel, mises Ã  jour, conformitÃ©). 0 = scans dÃ©sactivÃ©s |
| Fast Poll Interval | 3 Ã  30 s | 5 s | FrÃ©quence de vÃ©rification des commandes en attente lorsqu'une commande vient d'Ãªtre envoyÃ©e Ã  l'agent (mode rÃ©actif) |
| Max Missed Pushes | 1 Ã  20 | 3 | Nombre de push consÃ©cutifs manquÃ©s avant que l'agent bascule en statut Â« offline Â» |
| Notification Cooldown | 0 Ã  86400 s | 300 s | DÃ©lai minimum entre deux alertes rÃ©pÃ©tÃ©es pour le mÃªme appareil, pour Ã©viter le spam de notifications |

Trois rÃ©glages supplÃ©mentaires ne sont visibles **qu'au niveau global** (pas de surcharge par groupe/appareil possible) :

| RÃ©glage | Plage | DÃ©faut | RÃ´le |
|---|---|---|---|
| Inventory Retention | 7 Ã  365 jours | 90 jours | DurÃ©e de conservation des instantanÃ©s d'inventaire historiques |
| Auto-Approve Devices | boolÃ©en | DÃ©sactivÃ© | Si activÃ©, tout nouvel agent qui s'enregistre est approuvÃ© automatiquement, sans validation manuelle |
| 2FA Â« Trust this IP Â» duration | 0 Ã  8760 h | 24 h | DurÃ©e pendant laquelle un choix Â« Trust this IP Â» lors de la double authentification Ã©vite de redemander un code. 0 = fonction dÃ©sactivÃ©e, le code est toujours redemandÃ© |

## Bonnes pratiques

- Diminuer le **Push Interval** augmente la rÃ©activitÃ© du dashboard mais accroÃ®t la charge rÃ©seau et base de donnÃ©es sur un parc important ; Ã  ajuster selon la taille du parc.
- Le **Scan Interval** Ã  0 dÃ©sactive complÃ¨tement les scans d'inventaire â€” Ã  rÃ©server Ã  des cas trÃ¨s spÃ©cifiques (bande passante trÃ¨s contrainte), car cela prive l'inventaire et les politiques de conformitÃ© de donnÃ©es Ã  jour.
- Activer **Auto-Approve Devices** est pratique en dÃ©ploiement de masse contrÃ´lÃ© (mÃªme rÃ©seau, mÃªmes clÃ©s API dÃ©diÃ©es), mais supprime le filtre manuel d'approbation : Ã  n'activer que si l'accÃ¨s aux clÃ©s API de dÃ©ploiement est dÃ©jÃ  strictement contrÃ´lÃ©.
- Passer **2FA Trust this IP duration** Ã  0 impose de resaisir un code 2FA Ã  chaque connexion, y compris depuis un poste habituel â€” utile sur une installation Ã  exigence de sÃ©curitÃ© renforcÃ©e.