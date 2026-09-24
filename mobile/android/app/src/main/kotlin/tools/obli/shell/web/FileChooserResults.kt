package tools.obli.shell.web

import android.app.Activity
import android.content.Intent
import android.net.Uri

/** Uris picked in the system file chooser (single or multiple selection). */
object FileChooserResults {
    fun uris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) {
            val list = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
            if (list.isNotEmpty()) return list.toTypedArray()
        }
        return data.data?.let { arrayOf(it) }
    }
}
