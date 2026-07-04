Ce chapitre decrit les actions que vous pouvez declencher sur vos appareils, individuellement ou en lot.

## Agir sur plusieurs appareils a la fois

Des qu'au moins un appareil est coche dans le tableau, une barre d'actions groupees apparait avec un menu **Actions** proposant :

- **Approuver** — pour valider un ou plusieurs appareils en attente (visible uniquement si vous avez le droit de gerer les approbations et que le filtre "En attente" est actif) ;
- **Redemarrer l'agent** — relance le logiciel agent sans redemarrer la machine ;
- **Redemarrer** — redemarre la machine ;
- **Eteindre** — eteint la machine ;
- **Scanner l'inventaire** — force une remontee immediate du materiel et des logiciels installes ;
- **Mettre a jour l'agent** — declenche la mise a jour du logiciel agent vers la derniere version ;
- **Executer un script...** — lance un script sur tous les appareils selectionnes ;
- **Change group** — deplace les appareils selectionnes vers un autre groupe.

Pour les administrateurs uniquement, trois actions supplementaires apparaissent : **Transfer to another tenant** (transferer vers une autre organisation), **Supprimer**, et **Desinstaller l'agent**.

Si au moins un appareil selectionne ne prend pas en charge une action (par exemple un agent Legacy), le bouton correspondant est grise avec une infobulle l'indiquant — l'action n'est proposee que si tous les appareils selectionnes la supportent.

### Executer un script en lot

La fenetre **Executer un script...** permet de rechercher un script par son nom, un tag ou sa description. Si le script attend des parametres obligatoires, un message vous previent et vous invite a utiliser la page d'execution dediee (un lien **Ouvrir la page d'execution** est propose), qui permet de saisir ces parametres avant le lancement.

### Changer de groupe en lot

La fenetre **Change group** vous laisse choisir un groupe de destination dans la liste, ou la laisser vide pour deplacer les appareils vers **Ungrouped**.

## Agir sur un seul appareil : la fiche detaillee

En cliquant sur l'icone "oeil" d'une ligne, vous ouvrez la fiche complete de l'appareil. Son en-tete change selon l'etat de l'appareil.

### Appareil en attente d'approbation

Si l'appareil vient d'etre installe et attend une validation, seuls deux boutons apparaissent dans l'en-tete (pour les personnes autorisees a gerer les approbations) :

- **Approve** (vert) — valide l'appareil, qui integre alors automatiquement le groupe par defaut associe a la cle d'installation utilisee ;
- **Refuse** (rouge) — rejette l'appareil.

### Appareil approuve

Une fois l'appareil approuve, la barre d'action de l'en-tete propose (selon vos droits et les capacites de l'agent) :

- des liens croises vers d'autres outils Obliance eventuellement configures sur cette machine ;
- **Scan All** — declenche en une seule fois un scan d'inventaire, un scan des mises a jour et un controle de conformite ;
- le toggle **Airgap** (isolation reseau d'urgence, reserve aux administrateurs) ;
- **Mettre a jour l'agent** — n'apparait que si une mise a jour est disponible et que l'appareil n'est pas deja en train de se mettre a jour ;
- **Agent** — redemarre le logiciel agent ;
- **Sleep** — met la machine en veille ;
- **Reboot** — redemarre la machine ;
- **Off** — eteint la machine ;
- un bouton de rafraichissement qui recharge la fiche et force immediatement une remontee des indicateurs (metriques) de la machine.

Ces boutons agissent directement sur la machine : verifiez toujours que vous ciblez le bon appareil avant de cliquer sur **Sleep**, **Reboot** ou **Off**.

Si le mode confidentialite est actif sur cet appareil, un bouton orange **Disable** apparait dans l'en-tete pour le desactiver a distance.

Toutes ces actions sont desactivees (avec une infobulle explicative) si l'agent installe sur la machine ne les prend pas en charge, par exemple sur un agent Legacy.

### Le mode confidentialite (Privacy mode)

Lorsqu'un utilisateur active le mode confidentialite depuis son propre poste (via l'icone dans la zone de notification de sa machine), certaines fonctions de prise en main a distance sont bloquees pour proteger sa vie privee : les onglets **Scripts**, **Remote**, **Processes**, **Explorer**, ainsi que les sections personnalisees eventuelles.

- Si un mot de passe local a ete configure sur l'agent, ces onglets restent visibles mais demandent un deverrouillage temporaire (un compte a rebours s'affiche apres deverrouillage).
- Si aucun mot de passe n'est configure, ces onglets sont entierement bloques (icone de cadenas).

### La desinstallation d'un agent

Quand une desinstallation d'agent est en cours, un bandeau orange **Uninstall in progress** apparait en haut de la fiche, avec un compte a rebours. Un bouton **Cancel uninstall**, reserve aux administrateurs, permet d'annuler l'operation tant qu'elle n'est pas terminee. Si l'agent ne confirme pas la desinstallation dans les 10 minutes, l'appareil reapparait automatiquement dans vos listes.

## Quand une action est-elle possible ?

Certaines commandes (redemarrage, arret, execution de script, etc.) ne peuvent etre envoyees que si l'appareil est **joignable**, c'est-a-dire dans l'un des etats suivants : **En ligne**, **Attention** ou **Critique**. Un appareil **Hors ligne**, **En attente**, **Suspendu**, **En mise a jour**, **En erreur de mise a jour**, **En maintenance** ou **en desinstallation** ne peut pas recevoir de nouvelle commande tant qu'il n'est pas revenu dans l'un des trois etats joignables.