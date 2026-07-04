Une fois sur la fiche d'un appareil, ses informations sont reparties en plusieurs onglets. Ce chapitre decrit le contenu de chacun.

## Liste des onglets

La fiche comporte des onglets fixes — **Overview, Inventory, Scripts, Updates, Compliance, Remote, Explorer, Services, Processes, Tasks, Settings** — auxquels s'ajoutent, selon l'equipement de la machine, des onglets conditionnels : **Hyper-V** (si la machine heberge des machines virtuelles), **Backups** (si un logiciel de sauvegarde de type Veeam y est detecte), ainsi que d'eventuelles sections personnalisees configurees pour votre organisation, inserees juste apres l'onglet Remote.

## Overview

Vue d'ensemble de l'appareil : identite (nom de machine, nom affiche, systeme d'exploitation, version, architecture, version de l'agent installe, dernier utilisateur connecte, identifiant de l'agent) et reseau (adresse IP locale, adresse IP publique, adresse MAC, fuseau horaire, localisation). On y trouve aussi une section **Live Metrics** avec les indicateurs de charge en temps reel (CPU, memoire, disque, et indicateurs personnalises issus de vos propres scripts), un historique de ces indicateurs (moyenne, pic, variation sur 24h / 7 jours / 30 jours), ainsi que des informations rapides comme la date de derniere connexion ou de dernier redemarrage.

## Inventory

Deux sous-sections : **Hardware** (materiel detecte) et **Software** (logiciels installes, avec une recherche dediee). Vous pouvez egalement gerer les **licences logicielles** associees a cet appareil (ajout via un formulaire), et lancer manuellement un nouveau scan d'inventaire.

## Scripts

Trois sous-onglets :

- **History** — historique des executions de scripts sur cet appareil, avec leur statut (succes, echec, en cours, en attente, delai depasse, annule, ignore, envoye), la sortie du script, et un bouton pour arreter une execution en cours ;
- **Run** — lancement manuel d'un script sur cet appareil ;
- **Schedule** — planification d'une execution recurrente directement depuis la fiche.

## Updates

Liste des mises a jour detectees sur la machine, avec leur statut (par exemple "en attente de redemarrage"), un bouton pour relancer un scan manuel, la possibilite d'approuver individuellement une mise a jour ou toutes en une fois (**Approve all**), et un suivi en temps reel de leur installation.

## Compliance

Regroupe deux volets : la liste des **vulnerabilites connues (CVE)** correspondant aux logiciels installes sur la machine, avec leur niveau de gravite (critique, elevee, moyenne, faible, inconnue) et un lien vers la fiche officielle de la vulnerabilite (les administrateurs peuvent marquer une entree comme faux positif via **Dismiss**) ; et les resultats des **politiques de conformite** appliquees a cet appareil.

## Remote

Gere les prises en main a distance :

- **ObliReach** — partage d'ecran et controle a distance, avec detection automatique si le composant est installe sur la machine et comparaison entre sa version installee et la derniere version disponible ;
- des sessions a distance de plusieurs types : **Bureau a distance (RDP)**, **Connexion securisee (SSH)**, ou **Ligne de commande (CMD / PowerShell)** — pour ces deux dernieres, vous choisissez le contexte d'ouverture : session de l'utilisateur connecte ou compte SYSTEME ;
- sur une machine hebergeant des machines virtuelles, une **console VM** est egalement disponible.

## Explorer

Navigateur de fichiers a distance sur la machine : creation de nouveau dossier, envoi de fichier (**Upload**), telechargement (**Download**), renommage et suppression. Chaque action est desactivee si l'agent installe ne la prend pas en charge.

## Services / Processes / Tasks

- **Services** — liste des services systeme de la machine avec les actions Demarrer / Arreter / Redemarrer.
- **Processes** — liste des processus en cours d'execution, avec la possibilite d'en arreter un par son identifiant.
- **Tasks** — historique de toutes les commandes envoyees a cet appareil (filtrage, pagination, annulation d'une commande encore en attente), mis a jour automatiquement en temps reel.

## Settings (reserve aux administrateurs)

Cet onglet regroupe toute la configuration de l'appareil :

- **Identite** : nom affiche, description/note ;
- **Tags** : ajout et suppression ;
- **Champs personnalises** : paires cle/valeur libres ;
- **Surveillance** : possibilite de surcharger les reglages du groupe (frequence de remontee des indicateurs, frequence de scan, nombre d'echecs toleres avant de passer hors-ligne) ;
- **Notifications** : quels changements d'etat de cet appareil doivent generer une alerte (en ligne / hors ligne / avertissement / critique / mise a jour) ;
- **Affichage des indicateurs** : masquer certains graphiques (CPU, memoire, disque, reseau, temperatures, GPU), regrouper coeurs/threads, masquer la memoire d'echange, combiner lecture/ecriture disque ou entree/sortie reseau, renommer des capteurs ;
- **Conformite** : activation de la remediation automatique ;
- **Gestion d'actifs** : date d'achat, date de fin de garantie, fournisseur de garantie, duree de vie attendue de la machine ;
- **Seuils d'alerte personnalises** : possibilite de definir des seuils specifiques a cet appareil (avec indication visuelle de ce qui est herite du groupe).

### Mode confidentialite et mot de passe

Dans la section **Privacy mode**, un administrateur peut activer le mode confidentialite a distance (bouton **Enable privacy mode**, avec confirmation) — disponible uniquement si l'appareil est joignable. Une fois actif, sa desactivation se fait depuis le bouton **Disable** en haut de la fiche, ou localement sur la machine.

La section **Privacy password** permet de definir, changer ou retirer un mot de passe local de deverrouillage (**Set password / Change password / Remove password**), a condition que le mode confidentialite soit desactive et l'appareil joignable. Ce mot de passe n'est jamais stocke par Obliance : seule l'information "un mot de passe est defini" est connue du serveur.

### Danger Zone

Trois actions sensibles, reservees aux administrateurs :

| Action | Effet |
|---|---|
| **Transfer to another tenant** | Deplace l'appareil vers une autre organisation. Son groupe, ses indicateurs personnalises et ses resultats de conformite sont vides ; l'agent se reconfigure automatiquement avec une nouvelle cle au prochain envoi de donnees. |
| **Delete device** | Supprime l'appareil d'Obliance **sans** desinstaller l'agent sur la machine — celle-ci se reenregistrera automatiquement au prochain envoi de donnees, sauf si vous desinstallez aussi l'agent localement. |
| **Uninstall agent** | Envoie la commande de desinstallation immediate de l'agent sur la machine. L'appareil disparait de toutes les listes et sera supprime definitivement une fois la desinstallation confirmee. Sans confirmation sous 10 minutes, l'appareil reapparait — un bouton **Cancel** permet d'annuler l'operation tant qu'elle est en cours. |

Ces trois actions sont irreversibles ou impactantes : verifiez toujours que vous ciblez le bon appareil avant de confirmer.