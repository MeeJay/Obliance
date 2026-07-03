# Export et import groupÃ©s de scÃ©narios

En complÃ©ment de l'export par scÃ©nario, une section dÃ©diÃ©e Ã  la page ParamÃ¨tres permet de sauvegarder ou restaurer l'ensemble des scÃ©narios d'un tenant en une seule opÃ©ration.

## OÃ¹ la trouver

Page **ParamÃ¨tres** (accÃ¨s admin) â†’ section **Â« Scenarios â€” bulk export / import Â»**, sous la section gÃ©nÃ©rale Â« Import / Export Â».

Description affichÃ©e dans l'interface : Â« Per-scenario export is on the Automations â†’ Scenarios page (one click per row). Use this section to dump every scenario in the current tenant in a single JSON, or to restore from such a dump after migrating tenant. Â»

## Cas d'usage

- Sauvegarde complÃ¨te avant une opÃ©ration risquÃ©e (mise Ã  jour majeure, nettoyage, rÃ©organisation des tenants).
- Migration de l'ensemble des automatisations d'un tenant vers un autre, ou vers une nouvelle installation Obliance.

## Export groupÃ©

Deux boutons sont disponibles :

| Bouton | Contenu |
|---|---|
| Export all (lean) | Tous les scÃ©narios du tenant, scripts rÃ©fÃ©rencÃ©s par identifiant uniquement |
| Export all (with scripts) | Tous les scÃ©narios du tenant, avec le contenu complet de chaque script embarquÃ© (autonome, migrable vers une autre installation) |

Le fichier tÃ©lÃ©chargÃ© est un bundle JSON (avec son propre numÃ©ro de version de format) qui regroupe un export individuel par scÃ©nario.

## Import groupÃ©

1. Cliquez sur **Â« Import bulk JSON Â»**.
2. SÃ©lectionnez le fichier bundle prÃ©cÃ©demment exportÃ©.
3. Obliance importe chaque scÃ©nario du bundle et retourne un rapport indiquant, pour chaque scÃ©nario, s'il a Ã©tÃ© importÃ© avec succÃ¨s ou en Ã©chec.

Contrairement Ã  l'import unitaire, l'import groupÃ© ne propose pas de choix de stratÃ©gie par script en conflit : tout script dont l'identifiant existe dÃ©jÃ  dans le tenant cible est automatiquement **ignorÃ© (skip)**, l'existant Ã©tant conservÃ©. Ce comportement, volontairement simple et prÃ©visible, correspond Ã  ce qu'on attend d'un bouton de restauration de sauvegarde.

Comme pour l'import unitaire, chaque scÃ©nario importÃ© arrive au statut **draft** et sans appareil cible â€” aprÃ¨s une restauration groupÃ©e, prÃ©voyez de repasser sur chaque scÃ©nario pour rÃ©activer et recibler avant qu'ils ne se redÃ©clenchent.

## Permissions requises

Ces deux opÃ©rations nÃ©cessitent la permission de gestion des scripts (capacitÃ© `scripts.manage`) â€” comme pour l'import unitaire.