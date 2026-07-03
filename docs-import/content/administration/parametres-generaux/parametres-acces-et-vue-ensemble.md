La page **ParamÃ¨tres** regroupe les rÃ©glages globaux de l'installation Obliance ; cette page explique oÃ¹ la trouver, qui peut y accÃ©der, et dÃ©taille son premier bloc, la section **Ã€ propos**.

## AccÃ©der Ã  la page

1. Se connecter avec un compte disposant du rÃ´le **admin**.
2. Dans le menu latÃ©ral d'administration, cliquer sur **ParamÃ¨tres** (icÃ´ne en forme d'engrenage).
3. La page affiche directement la liste des sections dÃ©crites ci-dessous.

## Point d'attention â€” portÃ©e de l'accÃ¨s

Dans le menu latÃ©ral, l'entrÃ©e **Workspace** situÃ©e juste au-dessus de **ParamÃ¨tres** n'est visible que pour un administrateur connectÃ© sur le tenant principal (le tenant Â« Default Â», aussi appelÃ© tenant maÃ®tre). L'entrÃ©e **ParamÃ¨tres**, elle, est visible pour **tout compte admin, quel que soit le tenant sur lequel il est connectÃ©** â€” elle n'est pas rÃ©servÃ©e au tenant maÃ®tre.

En pratique, cela signifie qu'un administrateur crÃ©Ã© sur un tenant secondaire peut aujourd'hui ouvrir cette page et modifier des rÃ©glages qui sont en rÃ©alitÃ© **partagÃ©s par l'ensemble de l'installation** et non isolÃ©s par tenant : la sÃ©curitÃ© 2FA, la connexion SSO Obligate, la liste des extensions de fichiers autorisÃ©es dans l'explorateur distant, les seuils mÃ©triques par dÃ©faut, et les paramÃ¨tres de moniteur par dÃ©faut (intervalles de fonctionnement de l'agent). Ce comportement mÃ©riterait d'Ãªtre confirmÃ© (ou corrigÃ©) auprÃ¨s de l'Ã©diteur si une isolation stricte par tenant est attendue sur cette page.

En attendant une clarification, il est recommandÃ© de **limiter la distribution du rÃ´le admin sur les tenants secondaires** si vous ne souhaitez pas que ces comptes puissent modifier des rÃ©glages qui affectent toute l'installation.

## Ce qu'on ne trouve pas dans ParamÃ¨tres

Les canaux de notification utilisÃ©s pour les alertes de supervision (Slack, Discord, Teams, e-mail) ne se configurent **pas** depuis cette page : ils se trouvent sous **Politiques â†’ Notifications**. C'est une source de confusion frÃ©quente pour les administrateurs qui cherchent Ã  configurer leurs alertes ici.

## Sections de la page

La page ParamÃ¨tres est organisÃ©e en blocs successifs :

| Section | Contenu |
|---|---|
| Ã€ propos | Diagnostics techniques de l'installation (versions, uptime, ressources serveur) |
| ParamÃ¨tres de moniteur par dÃ©faut | Intervalles de fonctionnement de l'agent (push, scan, poll...) |
| Seuils mÃ©triques globaux | Seuils d'alerte par dÃ©faut pour disque, CPU, RAM |
| Quick Reply Templates | RÃ©ponses rapides prÃ©dÃ©finies pour le chat opÃ©rateur |
| Serveurs SMTP | Configuration des serveurs d'envoi d'e-mail |
| SÃ©curitÃ© | Activation et exigence du 2FA |
| Obligate SSO Gateway | Connexion Ã  la passerelle d'authentification unique Obligate |
| File explorer â€” editable extensions | Extensions de fichiers ouvrables dans l'Ã©diteur intÃ©grÃ© |
| Import / Export | Export/import JSON de la configuration (groupes, moniteurs, rÃ©glages...) |
| Scenarios â€” bulk export / import | Export/import JSON en masse de tous les scÃ©narios du tenant |

Toutes ces sections sont rÃ©servÃ©es aux comptes admin. Chacune est dÃ©taillÃ©e dans les pages suivantes de ce chapitre.

## Section Â« Ã€ propos Â»

Cette section affiche un Ã©tat des lieux technique de l'installation, utile pour le support et le diagnostic :

**Versions**
- Version du Serveur
- Version du Client
- Version de l'Agent
- Version de Reach (Oblireach)
- Version de Node.js

**Ã‰tat du systÃ¨me**
- Uptime du serveur, formatÃ© en jours / heures / minutes
- Environnement d'exÃ©cution : Docker ou Native
- Plateforme du systÃ¨me d'exploitation hÃ´te
- Nombre de cÅ“urs CPU disponibles

**MÃ©moire**
- MÃ©moire utilisÃ©e par le processus serveur (RSS)
- MÃ©moire de tas (heap) utilisÃ©e par le processus
- MÃ©moire systÃ¨me libre et mÃ©moire systÃ¨me totale, en MB

**Charge et base de donnÃ©es**
- Charge CPU moyenne sur 1, 5 et 15 minutes
- Statut de connexion Ã  la base de donnÃ©es PostgreSQL (connectÃ© / erreur)

Cette section est en lecture seule : elle sert au diagnostic, pas Ã  la configuration. C'est le premier rÃ©flexe Ã  avoir en cas de lenteur ou d'incident serveur signalÃ© par les utilisateurs, avant de creuser plus loin dans les logs.