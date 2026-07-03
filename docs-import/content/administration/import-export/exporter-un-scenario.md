# Exporter un scÃ©nario

Chaque scÃ©nario d'automatisation peut Ãªtre tÃ©lÃ©chargÃ© sous forme de fichier JSON, pour sauvegarde, partage, ou gÃ©nÃ©ration assistÃ©e par IA.

## Export depuis la page Automations

1. Ouvrez **Automations** (`/schedules`) puis l'onglet **ScÃ©narios**.
2. RepÃ©rez la ligne du scÃ©nario Ã  exporter.
3. Cliquez sur l'icÃ´ne de tÃ©lÃ©chargement (Â« Export this scenario as JSON Â»).
4. Choisissez l'une des deux options proposÃ©es dans le menu :

| Option | Description affichÃ©e | Contenu | PortabilitÃ© |
|---|---|---|---|
| Export (lean) | Â« Scenario only â€” references scripts by id Â» | Le scÃ©nario seul ; chaque script est rÃ©fÃ©rencÃ© par son identifiant numÃ©rique interne | Fiable uniquement au sein de la mÃªme installation (ex. dupliquer un scÃ©nario, ou le partager entre tenants d'une mÃªme installation master) |
| Export with scripts | Â« Self-contained â€” embeds full script bodies Â» | Le scÃ©nario + le contenu complet de chaque script rÃ©fÃ©rencÃ© + les schedules liÃ©s (ceux qui dÃ©clenchent ce scÃ©nario en cas d'Ã©chec, ou qui interviennent dans une Ã©tape de dÃ©clenchement du scÃ©nario) | Autonome, exploitable dans un autre tenant ou une autre installation Obliance |

Le fichier est tÃ©lÃ©chargÃ© directement par le navigateur au format `.json`.

## ModÃ¨le vide pour gÃ©nÃ©rer un scÃ©nario avec une IA

Le bouton **Â« Empty template Â»** (Â« Download an empty scenario JSON to share with an AI / colleague Â») tÃ©lÃ©charge un squelette JSON commentÃ©, avec un exemple de chaque type d'Ã©tape et de dÃ©clencheur disponible dans Obliance. C'est le fichier Ã  coller dans un prompt d'assistant IA, accompagnÃ© d'une description en langage naturel du comportement souhaitÃ©, pour obtenir en retour un scÃ©nario prÃªt Ã  Ãªtre importÃ©.

## Ce que contient le fichier

Le fichier exportÃ© est un objet JSON versionnÃ© (`formatVersion`, actuellement 2) dont la structure ressemble Ã  ceci :

```json
{
  "formatVersion": 2,
  "scenario": { "name": "...", "description": "..." },
  "nodes": [ { "clientId": "...", "type": "...", "config": {} } ],
  "edges": [ { "sourceNodeClientId": "...", "targetNodeClientId": "..." } ],
  "scripts": null,
  "schedules": null
}
```

- `scenario` : les mÃ©tadonnÃ©es (nom, description, statut d'origine, etc.).
- `nodes` : la liste des Ã©tapes et dÃ©clencheurs, avec leur configuration.
- `edges` : les liaisons entre Ã©tapes.
- `scripts` / `schedules` : `null` en export lean, remplis en export Â« with scripts Â».

Depuis la version 2 du format, une temporisation (Â« cooldown Â») entre deux dÃ©clenchements est reprÃ©sentÃ©e comme une Ã©tape Ã  part entiÃ¨re dans le scÃ©nario, et non plus comme un simple paramÃ¨tre du dÃ©clencheur.

## Points d'attention avant de partager un export

- **Ciblage multi-tenant** : si le scÃ©nario est partagÃ© avec d'autres tenants (paramÃ©trage rÃ©servÃ© au tenant master), cette information n'est pas incluse dans l'export â€” elle devra Ãªtre reconfigurÃ©e manuellement aprÃ¨s un import.
- **Contenu des scripts** : un export Â« with scripts Â» embarque le code source complet de vos scripts. Avant de le partager en dehors de votre organisation, vÃ©rifiez qu'aucun secret (mot de passe, clÃ©, jeton) n'est Ã©crit en dur dans vos scripts â€” privilÃ©giez un mÃ©canisme de gestion de secrets externe et appliquez le principe du moindre privilÃ¨ge sur les identifiants utilisÃ©s.