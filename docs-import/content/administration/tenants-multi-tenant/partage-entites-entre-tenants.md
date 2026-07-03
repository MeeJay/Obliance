Au-delÃ  de la vue globale du tenant Default, Obliance permet de partager explicitement une entitÃ© donnÃ©e vers un ou plusieurs tenants enfants, en lecture seule, sans dupliquer les donnÃ©es. On appelle cela la **diffusion** (fan-out).

## Principe gÃ©nÃ©ral

Seul le tenant Default peut diffuser des entitÃ©s vers d'autres tenants â€” l'inverse n'existe pas, et deux tenants enfants ne peuvent pas se partager des entitÃ©s entre eux directement. Les types d'entitÃ©s concernÃ©s par ce mÃ©canisme de diffusion sont :

- les scripts ;
- les scÃ©narios (automatisations conditionnelles) ;
- les automatisations planifiÃ©es (schedules) ;
- les politiques de conformitÃ© ;
- les sections personnalisÃ©es ;
- les clÃ©s API.

Les canaux de notification suivent un principe de partage similaire dans l'esprit (rendre un canal disponible pour plusieurs tenants), mais via un mÃ©canisme distinct gÃ©rÃ© directement depuis la page de configuration du canal, et non via le sÃ©lecteur de diffusion dÃ©crit ci-dessous.

## Configurer une diffusion depuis Default

Lorsque vous crÃ©ez ou modifiez une entitÃ© Ã©ligible (script, scÃ©nario, automatisation planifiÃ©e, politique de conformitÃ©, section personnalisÃ©e, clÃ© API) en Ã©tant connectÃ© sur le tenant Default, un bloc **"Diffuser Ã  (lecture seule sur les tenants ciblÃ©s)"** apparaÃ®t dans le formulaire. Il se prÃ©sente sous forme d'une rangÃ©e de chips (Ã©tiquettes cliquables), une par tenant enfant existant â€” le tenant Default lui-mÃªme n'apparaÃ®t pas dans cette liste puisqu'il est dÃ©jÃ  propriÃ©taire de l'entitÃ©.

- Aucune sÃ©lection : l'entitÃ© reste privÃ©e Ã  Default, aucun autre tenant ne la voit.
- Une ou plusieurs sÃ©lections : l'entitÃ© devient visible en lecture seule pour chaque tenant sÃ©lectionnÃ©.
- Le rappel affichÃ© sous les chips est explicite : "Le tenant Default reste propriÃ©taire ; les tenants ciblÃ©s voient l'entitÃ© en lecture seule et ne peuvent pas la modifier."
- Cliquer Ã  nouveau sur un chip dÃ©jÃ  sÃ©lectionnÃ© le dÃ©sÃ©lectionne ; en dÃ©sÃ©lectionnant tous les chips, l'entitÃ© redevient privÃ©e Ã  Default.

Ce bloc n'apparaÃ®t que lorsque vous Ã©ditez depuis le tenant Default ; il est absent des formulaires des autres tenants, qui n'ont pas la capacitÃ© de diffuser.

## Ce que voit un tenant destinataire

Une entitÃ© diffusÃ©e apparaÃ®t dans les listes du tenant destinataire exactement comme si elle lui appartenait, avec deux diffÃ©rences visuelles :

- un badge **"ðŸ”’ Master"** est affichÃ© Ã  cÃ´tÃ© de son nom pour signaler qu'elle appartient en rÃ©alitÃ© au tenant Default ;
- les boutons de modification et de suppression sont dÃ©sactivÃ©s, avec l'info-bulle **"GÃ©rÃ© par le tenant Default â€” lecture seule"**.

Ce comportement est illustrÃ© ici sur l'onglet ScÃ©narios de la page Automations ; le mÃªme principe de lecture seule (badge et boutons dÃ©sactivÃ©s) s'applique aux pages Scripts, Automatisations planifiÃ©es et Politiques de conformitÃ©, qui partagent le mÃªme mÃ©canisme technique. Le libellÃ© exact peut varier lÃ©gÃ¨rement d'une page Ã  l'autre.

## Visualiser les diffusions en cours depuis Default

Depuis le tenant Default, en plus du sÃ©lecteur de diffusion, deux aides visuelles supplÃ©mentaires n'apparaissent que dans la vue globale :

- Sur la fiche d'une entitÃ© dÃ©jÃ  diffusÃ©e, des chips rÃ©sumant les tenants destinataires s'affichent, avec l'info-bulle **"DiffusÃ© en lecture seule Ã  ces tenants"**. Ces chips ne s'affichent que s'il y a au moins un tenant destinataire, et uniquement cÃ´tÃ© Default â€” les tenants destinataires n'en ont pas besoin puisqu'ils voient dÃ©jÃ  l'entitÃ© elle-mÃªme.
- Dans les listes d'entitÃ©s partageables (scripts, scÃ©narios, automatisations planifiÃ©es, politiques de conformitÃ©, etc.), un badge indique le tenant propriÃ©taire de chaque ligne quand plusieurs tenants sont mÃ©langÃ©s dans l'affichage ; le tenant Default y ressort avec une couleur accentuÃ©e (bleu) pour le distinguer visuellement des tenants enfants.
- Si plusieurs tenants sont reprÃ©sentÃ©s dans une mÃªme liste, une rangÃ©e de chips de filtrage permet de restreindre l'affichage Ã  un ou plusieurs tenants prÃ©cis. Le chip du tenant Default apparaÃ®t toujours en premier avec le suffixe "(master)", suivi d'un bouton **Effacer** dÃ¨s qu'au moins un filtre est actif.

## Lien direct vers un appareil d'un autre tenant

Lorsqu'un lien direct vers la fiche d'un appareil (URL du type `.../devices/123`) est partagÃ© Ã  un utilisateur, Obliance dÃ©tecte automatiquement Ã  quel tenant appartient cet appareil :

- si le tenant actuellement sÃ©lectionnÃ© dans la session de l'utilisateur ne correspond pas au tenant propriÃ©taire de l'appareil, l'interface **bascule silencieusement** son espace de travail vers le bon tenant avant d'afficher la fiche, sans action manuelle de sa part ;
- un administrateur plateforme peut toujours accÃ©der Ã  n'importe quel appareil de cette faÃ§on ;
- un utilisateur standard doit Ãªtre membre du tenant propriÃ©taire de l'appareil et disposer d'un droit de lecture sur cet appareil via son Ã©quipe pour que le lien fonctionne ; sinon la fiche s'affiche comme introuvable, exactement comme si l'appareil n'existait pas, afin de ne pas rÃ©vÃ©ler son existence Ã  quelqu'un qui n'a pas le droit de le voir ;
- le tenant Default n'est jamais redirigÃ© par ce mÃ©canisme, puisque sa vue globale inclut dÃ©jÃ  tous les appareils de l'installation.