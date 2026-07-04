Obliance propose deux mecanismes d'import/export totalement independants, a ne pas confondre lorsqu'on prepare une migration, une sauvegarde ou un partage de configuration.

## Les deux systemes

| Systeme | Ou le trouver | Contenu | Usage typique |
|---|---|---|---|
| **Import/Export global (admin)** | Menu admin **Import/Export** | Groupes d'appareils, parametres, canaux de notification, teams, actions et bindings de remediation | Sauvegarde ou migration d'une installation complete |
| **Export/Import de scenario** | Page **Automations > Scenarios**, menu d'un scenario | Un scenario (etapes, conditions, declencheurs), avec ou sans les scripts associes | Partager un scenario avec un collegue, generer un scenario via une IA, dupliquer un scenario entre tenants |

Ces deux systemes produisent des fichiers JSON qui ne sont **pas interchangeables** : un fichier issu de l'export global ne peut pas etre importe depuis la page Scenarios, et inversement.

## Quand utiliser quoi

- **Vous voulez sauvegarder ou dupliquer la configuration generale** (groupes d'appareils, teams, canaux de notification, parametres, actions de remediation) : utilisez le module **Import/Export** du menu admin. Voir la page dediee "Export et import global".
- **Vous voulez sauvegarder, partager ou migrer un scenario d'automatisation precis** (par exemple avant un refactor risque, ou pour le faire generer/ameliorer par une IA) : utilisez le bouton d'export directement sur le scenario, dans Automations > Scenarios. Voir la page dediee "Export et import de scenarios".

## Point de vigilance important

Au moment de la redaction de cette documentation, le module **Import/Export global** (menu admin) presente un dysfonctionnement connu sur la version actuelle : les actions d'export et d'import de cette page peuvent echouer sans produire de fichier exploitable. Avant de vous appuyer sur ce module pour une sauvegarde critique, verifiez sur votre instance que l'export et l'import fonctionnent effectivement de bout en bout, ou rapprochez-vous du support/de l'equipe technique pour confirmer que le probleme a ete corrige sur votre version.

Le module **Export/Import de scenario**, en revanche, est pleinement operationnel et peut etre utilise en confiance.

> Build a lancer : aucun (documentation uniquement)