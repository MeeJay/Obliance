package tools.obli.core.model

/**
 * Two-letter monogram of a server tile: initials of the first two words
 * ("Client Durand" -> "CD"), else the first two letters ("Atelier" -> "AT"),
 * CamelCase counts as two words ("BinaryHearts" -> "BH"). Letters and digits
 * only, upper case; "?" when nothing usable is left.
 */
object Monogram {
    fun of(displayName: String): String {
        val words = displayName
            .split(Regex("[^\\p{L}\\p{N}]+"))
            .filter { it.isNotEmpty() }
        if (words.isEmpty()) return "?"
        if (words.size >= 2) return (initial(words[0]) + initial(words[1])).uppercase()
        val word = words[0]
        val upperAfterFirst = word.drop(1).indexOfFirst { it.isUpperCase() }
        if (upperAfterFirst >= 0) return (initial(word) + word[upperAfterFirst + 1]).uppercase()
        return word.take(2).uppercase()
    }

    private fun initial(word: String): String = word.first().toString()
}
