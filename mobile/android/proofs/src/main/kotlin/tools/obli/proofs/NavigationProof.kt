package tools.obli.proofs

import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay

/** Route keys of the proof (the real ones are @Serializable NavKeys, design doc §10.7). */
sealed interface ProofKey : NavKey
data object TriageKey : ProofKey
data class DeviceKey(val id: Long) : ProofKey

/** Proof 2: Navigation 3 back stack + adaptive list-detail scene (phone: one pane, tablet: two). */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
fun TriageNavigation(initial: List<ProofKey> = listOf(TriageKey), onOpen: (Long) -> Unit = {}) {
    val backStack = remember { mutableStateListOf<ProofKey>().apply { addAll(initial) } }
    val strategy = rememberListDetailSceneStrategy<ProofKey>()
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        sceneStrategies = listOf(strategy),
        entryProvider = entryProvider {
            entry<TriageKey>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = { Text("Sélectionnez un appareil") })) {
                Text("À traiter")
            }
            entry<DeviceKey>(metadata = ListDetailSceneStrategy.detailPane()) { key ->
                onOpen(key.id)
                Text("Appareil ${key.id}")
            }
        },
    )
}
