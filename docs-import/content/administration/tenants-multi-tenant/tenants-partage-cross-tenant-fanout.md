Cette page decrit le mecanisme de partage cross-tenant, qui permet de diffuser une entite du tenant Default vers un ou plusieurs autres tenants en lecture seule, sans dupliquer l'entite.

## Principe general

Par defaut, l'isolation entre tenants est totale. Le partage cross-tenant ("fan-out") est un mecanisme explicite qui permet de deroger a cette regle pour certains types d'entites : au lieu de dupliquer une entite dans chaque tenant, le tenant Default reste **proprietaire unique** de l'entite et choisit de la **diffuser en lecture seule** vers un ou plusieurs tenants enfants.

Ce mecanisme n'est disponible que depuis le tenant Default (tenant master). Un tenant enfant ne peut ni initier de partage, ni partager une entite vers un autre tenant enfant.

## Entites concernees

Le partage cross-tenant est disponible pour :

- les **scripts**,
- les **scenarios** (automatisations),
- les **plannings** (schedules),
- les **politiques de conformite**,
- les **sections personnalisees** du tableau de bord,
- les **cles API** de deploiement d'agents.

Les **canaux de notification** suivent une logique de partage similaire mais geree depuis leur propre ecran de configuration (page Notifications), et non via le composant de diffusion decrit ci-dessous.

Les **equipes** ne sont jamais partageables entre tenants : une equipe reste strictement rattachee a un seul tenant. Pour donner acces a un meme perimetre de droits sur plusieurs tenants, il faut recreer une equipe equivalente dans chacun des tenants concernes.

## Configurer le partage depuis le formulaire d'une entite

Sur le formulaire de creation ou d'edition d'un script, scenario, planning ou politique de conformite (visible uniquement en travaillant depuis le tenant Default), une zone **"Diffuser a (lecture seule sur les tenants cibles)"** presente une rangee de puces (chips) selectionnables, une par tenant enfant existant. Le tenant Default lui-meme n'apparait pas dans cette liste, puisqu'il est deja proprietaire de l'entite.

- Selectionner une ou plusieurs puces ajoute ces tenants a la liste de diffusion de l'entite ; cliquer a nouveau sur une puce deja selectionnee la retire de la selection.
- Ne selectionner aucun tenant equivaut a ne rien partager : l'entite reste visible uniquement depuis le tenant Default.

Un message d'aide rappelle la regle : *"Le tenant Default reste proprietaire ; les tenants cibles voient l'entite en lecture seule et ne peuvent pas la modifier."*

## Ce que voit un tenant destinataire

Depuis un tenant enfant qui a ete choisi comme destinataire d'un partage, l'entite partagee apparait directement dans les listes concernees (scripts, scenarios, plannings ou conformite), au meme titre que les entites propres au tenant. Elle peut etre consultee et, selon le type d'entite, executee ou appliquee, mais :

- elle ne peut **pas** etre modifiee,
- elle ne peut **pas** etre supprimee,
- toute tentative de modification depuis ce tenant est rejetee.

Seul le tenant Default, proprietaire de l'entite, peut la modifier ou la supprimer.

## Ce que voit le tenant Default sur une entite partagee

Depuis le tenant Default, une entite qui a ete diffusee vers un ou plusieurs tenants affiche des **badges** indiquant vers quels tenants elle est partagee (un badge par tenant destinataire), avec l'info-bulle *"Diffuse en lecture seule a ces tenants"* au survol. Ces badges ne sont visibles que depuis la vue master ; un tenant destinataire ne les voit pas, puisqu'il voit deja l'entite directement dans ses propres listes.

## Suppression d'un tenant destinataire

Si un tenant qui figurait dans la liste de diffusion d'une ou plusieurs entites est supprime, ce tenant est automatiquement retire des listes de diffusion concernees au moment de la suppression : aucune action manuelle n'est necessaire sur les entites partagees, elles restent valides et continuent d'etre diffusees normalement vers les tenants destinataires restants.