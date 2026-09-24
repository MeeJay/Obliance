package tools.obli.shell.core

/** Android package naming of the Obli shells: one package per app id. */
object ObliApps {
    const val PACKAGE_PREFIX = "tools.obli."

    fun parseIds(csv: String): List<String> =
        csv.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()

    /**
     * Candidate packages for [appId], most likely first: a debug build of this
     * shell prefers the debug build of its sibling, then the release one.
     */
    fun candidatePackages(appId: String, ownPackage: String): List<String> {
        val release = PACKAGE_PREFIX + appId
        return if (ownPackage.endsWith(".debug")) listOf("$release.debug", release) else listOf(release)
    }
}
