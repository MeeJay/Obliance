Certains systemes anciens (Windows Server 2008 R2 notamment) ne peuvent pas faire tourner l'agent Obliance moderne. Ils sont geres par une variante allegee de l'agent, appelee **Legacy**, dont les capacites â€” et notamment la mise a jour a distance â€” sont volontairement plus limitees.

## Deux familles d'agents

Obliance distingue deux types ("flavors") d'agent installes sur le parc :

- **Agent moderne** â€” pour Windows 10 et plus recent, ainsi que Windows Server 2012/2016 et au-dela, macOS et Linux. C'est celui qui beneficie de toutes les fonctionnalites, y compris la mise a jour a distance decrite dans les pages precedentes.
- **Agent Legacy** â€” pour les systemes plus anciens qui ne supportent pas l'agent moderne, en particulier **Windows Server 2008 R2**. Il couvre un socle de commandes plus restreint.

Le type d'agent installe sur un device est detecte automatiquement par le serveur et reste visible dans l'interface.

## Ce qu'un agent Legacy ne sait pas faire

Un device identifie comme Legacy porte un badge orange/ambre **Legacy**, avec une info-bulle qui liste explicitement ce qui n'est pas disponible sur ce type d'agent :

- Pas de shell distant
- Pas d'ObliReach (prise en main a distance / streaming d'ecran)
- Pas de verification de conformite logicielle
- **Pas de mise a jour a distance (auto-update)**

Ce badge est visible aussi bien dans la liste des devices que sur la fiche detail de l'appareil, ce qui permet de reperer immediatement un poste Legacy sans avoir a ouvrir sa fiche.

Concretement, cela signifie que la commande **Update agent** ne peut pas etre envoyee a un agent Legacy : le serveur la refuse avec un message d'erreur explicite si elle est tentee sur ce type de device. Lors d'une mise a jour en lot sur une selection mixte (agents modernes + Legacy), les devices Legacy sont automatiquement ecartes de l'envoi â€” seuls les agents modernes de la selection recoivent effectivement la commande.

Plus generalement, chaque bouton ou action de l'interface qui n'est pas supporte par le type d'agent installe est desactive, avec une info-bulle generique : **"Not supported by this agent build"**.

## Faire evoluer un poste Legacy

Puisqu'un agent Legacy ne peut pas se mettre a jour lui-meme ni recevoir la commande de mise a jour a distance, la seule voie pour en changer la version consiste a **redeployer** l'agent adapte depuis zero sur le poste concerne.

Le deploiement d'un nouvel agent (menu global d'ajout d'agent) propose trois options selon la cible :

| Option | Cible | Mode de deploiement |
|---|---|---|
| Windows 10+ | Postes recents / Windows moderne | Script PowerShell avec telechargement direct + installeur MSI |
| Server 2012/2016 | Windows Server intermediaire | Script PowerShell avec transfert via BITS + installeur MSI (contournement TLS) |
| **Server 2008 R2** | Systemes tres anciens | Script a executer avec la mention *"Run in PowerShell (admin) â€” Server 2008 R2 / 2012"*, transfert via BITS + executable dedie (pas de MSI) |

L'option **Server 2008 R2** installe l'agent Legacy via un executable dedie et l'enregistre comme service Windows, sans passer par un installeur MSI classique â€” c'est une methode de deploiement differente de celle des agents modernes, adaptee aux limitations de ces systemes anciens.

## A retenir pour l'administration du parc

- Un badge **Legacy** = pas de mise a jour a distance possible pour ce poste, quelle que soit la version cible.
- Pour faire monter de version un poste Legacy vers l'agent moderne (si l'OS le permet), il faut desinstaller/reinstaller via le script de deploiement adapte, pas via la commande **Update agent**.
- Si un OS ancien ne supporte que l'agent Legacy (ex. Server 2008 R2), il restera durablement sur cette variante : il n'y a pas de trajectoire de mise a jour a distance vers l'agent moderne pour ce type de systeme.

â†’ Aucune action serveur ou client necessaire pour publier ce document.