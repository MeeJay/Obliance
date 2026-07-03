Ce chapitre explique comment declencher et piloter la mise a jour des agents Obliance installes sur les postes et serveurs geres, depuis l'interface d'administration.

## Principe general

Contrairement a une idee recue, l'agent Obliance ne se met **pas a jour tout seul de facon autonome et periodique**. La mise a jour est **poussee explicitement par un administrateur**, agent par agent ou en lot, depuis l'interface. C'est cette action qui declenche reellement l'installation de la nouvelle version sur le poste cible.

L'installation elle-meme (une fois la commande envoyee) est geree par le programme d'installation Windows (Windows Installer). C'est lui qui arrete le service de l'agent, remplace les fichiers, puis redemarre le service. L'administrateur n'a rien d'autre a faire une fois la commande lancee.

La version de reference du parc est celle publiee par le serveur Obliance lui-meme (un seul numero de version, par exemple `4.5.70`). C'est vers cette version que tous les agents sont pousses lorsqu'on declenche une mise a jour, sans avoir besoin de preciser quoi que ce soit : le serveur applique automatiquement sa propre version courante si aucune version n'est precisee dans la commande.

## Mettre a jour un agent individuel

1. Ouvrir la fiche du device concerne (menu **Agents**, page detail).
2. Cliquer sur le bouton **Update agent** (ou l'icone de telechargement associee).
3. Confirmer l'action si une demande de validation s'affiche (voir plus bas, restriction et validation en deux etapes).

Le device passe alors en statut **Updating** le temps de l'operation.

## Mettre a jour plusieurs agents en une seule fois

1. Depuis la liste des devices (**Agents**), selectionner les agents a mettre a jour a l'aide des cases a cocher.
2. Ouvrir le menu d'actions groupees et choisir **Update agent**.
3. Une confirmation s'affiche : *"Update the agent on {{count}} device(s)?"* â€” valider.
4. Un message de fin recapitule combien de devices ont effectivement recu la commande.

A noter : si la selection contient des agents **Legacy** (voir plus bas), ceux-ci sont automatiquement ignores par l'action groupee â€” ils n'acceptent pas cette commande. Le compte final rapporte uniquement les devices reellement mis a jour.

## Un pill "Update available" avant meme de lancer la mise a jour

Sur la liste des devices comme sur la fiche detail, un petit badge bleu **Update available** peut apparaitre a cote d'un agent : il signale que la version installee sur ce poste est differente de la version courante servie par votre installation Obliance. C'est une simple indication visuelle â€” elle ne declenche rien automatiquement, elle sert a reperer en un coup d'oeil les agents a rafraichir. Ce badge disparait des lors que l'agent est deja en cours de mise a jour ou en erreur de mise a jour, pour ne pas faire doublon avec le statut affiche.

## Restriction et validation (Power actions)

La commande de mise a jour d'agent fait partie des actions classees comme "Power" (actions potentiellement impactantes) dans le moteur de restriction d'Obliance :

- Elle est **reservee aux comptes administrateur** â€” un utilisateur standard ne peut ni la voir ni la declencher, meme sur les devices auxquels il a acces en ecriture.
- Selon la configuration de securite de votre installation, elle peut etre soumise a une **validation en deux etapes** avant execution effective (le meme mecanisme que pour les autres actions sensibles du parc). Si c'est le cas chez vous, une etape de confirmation supplementaire s'affiche avant l'envoi reel de la commande.

## Que se passe-t-il concretement sur le poste ?

Une fois la commande recue par l'agent :

1. L'agent previent le serveur qu'il commence sa mise a jour â€” le device bascule en statut **Updating**.
2. L'installeur Windows prend le relais : arret du service, remplacement des fichiers, redemarrage du service avec la nouvelle version.
3. Des que l'agent redemarre et se reconnecte avec la nouvelle version, le device repasse automatiquement en fonctionnement normal.

Ce flux est traite en detail (statuts, delais, cas d'erreur) dans la page dediee au suivi des mises a jour.

â†’ Aucune action serveur ou client necessaire pour publier ce document.