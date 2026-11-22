package cz.myx.petrel

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Protokol stahování logů ze Shearwater přes sériový port (Bluetooth Classic, Petrel 2) – podle libdivecomputer
 * (shearwater_common.c, shearwater_petrel.c). Jen čtení: RDBI 0x22 a stažení paměti 0x35/0x36/0x37.
 */
class Shearwater(private val inp: InputStream, private val out: OutputStream, private val cancelled: () -> Boolean, private val log: (String) -> Unit = {}) {
    class Cancelled : IOException("Stahování ukončeno")

    companion object {
        private const val END = 0xC0
        private const val ESC = 0xDB
        private const val ESC_END = 0xDC
        private const val ESC_ESC = 0xDD
        const val ID_SERIAL = 0x8010
        const val ID_FIRMWARE = 0x8011
        const val ID_LOGUPLOAD = 0x8021
        const val ID_MODEL = 0x8060
        const val MANIFEST_ADDR = 0xE0000000L
        const val MANIFEST_SIZE = 0x600
        const val DIVE_SIZE = 0xFFFFFF
        private val READ_ONLY = setOf(0x22, 0x35, 0x36, 0x37)
        /** Ukončení spojení (jako libdivecomputer při zavření) – jediný povolený příkaz mimo čtení. */
        private val SHUTDOWN = byteArrayOf(0x2E, 0x90.toByte(), 0x20, 0x00)
        fun hex(b: ByteArray) = b.joinToString(" ") { "%02x".format(it.toInt() and 0xFF) }
        val MODELS = mapOf(2 to "Predator", 3 to "Petrel 2", 4 to "NERD", 5 to "Perdix", 6 to "Perdix AI", 7 to "NERD 2",
            8 to "Teric", 9 to "Peregrine", 10 to "Petrel 3", 11 to "Perdix 2", 12 to "Tern", 13 to "Peregrine TX", 14 to "Perdix 3")

        /** Ponor je celý: hlavička 0x10, patička 0x20 a závěrečný záznam 0xFF. */
        fun complete(d: ByteArray): Boolean {
            var o = false; var c = false; var f = false
            var i = 0
            while (i + 32 <= d.size) {
                when (d[i].toInt() and 0xFF) { 0x10 -> o = true; 0x20 -> c = true; 0xFF -> f = true }
                i += 32
            }
            return o && c && f
        }
    }

    /** Vyprázdní příchozí data (po připojení). */
    fun purge() { Thread.sleep(300); while (inp.available() > 0) inp.read(ByteArray(inp.available())) }

    private fun slipWrite(data: ByteArray) {
        val b = ByteArrayOutputStream()
        for (x in data) {
            when (val c = x.toInt() and 0xFF) {
                END -> { b.write(ESC); b.write(ESC_END) }
                ESC -> { b.write(ESC); b.write(ESC_ESC) }
                else -> b.write(c)
            }
        }
        b.write(END)
        out.write(b.toByteArray()); out.flush()
    }

    private fun readByte(deadline: Long): Int {
        while (inp.available() <= 0) {
            if (cancelled()) throw Cancelled()
            if (System.currentTimeMillis() > deadline) throw IOException("Počítač neodpovídá (časový limit)")
            Thread.sleep(5)
        }
        val c = inp.read()
        if (c < 0) throw IOException("Spojení přerušeno")
        return c
    }

    private fun slipRead(timeoutMs: Long = 10000): ByteArray {
        val b = ByteArrayOutputStream()
        val deadline = System.currentTimeMillis() + timeoutMs
        var escaped = false
        while (true) {
            var c = readByte(deadline)
            if (c == END) { if (b.size() > 0) return b.toByteArray(); continue }
            if (c == ESC) { escaped = true; continue }
            if (escaped) { c = when (c) { ESC_END -> END; ESC_ESC -> ESC; else -> c }; escaped = false }
            b.write(c)
        }
    }

    /** Odešle požadavek (FF 01 [délka+1] 00 …) a vrátí odpověď bez hlavičky. */
    fun transfer(req: ByteArray): ByteArray {
        if ((req[0].toInt() and 0xFF) !in READ_ONLY) throw IOException("Pojistka: příkaz není čtení – neodeslán")
        slipWrite(byteArrayOf(0xFF.toByte(), 0x01, (req.size + 1).toByte(), 0x00) + req)
        val p = slipRead()
        if (p.size < 4 || (p[0].toInt() and 0xFF) != 0x01 || (p[1].toInt() and 0xFF) != 0xFF || p[3].toInt() != 0) throw IOException("Neplatná hlavička odpovědi")
        val len = (p[2].toInt() and 0xFF) - 1
        if (len < 0 || len + 4 != p.size) throw IOException("Neplatná délka odpovědi")
        return p.copyOfRange(4, p.size)
    }

    /** Ukončí spojení s počítačem (Petrel ukončí Upload log); odpověď se nečeká. */
    fun shutdown() {
        slipWrite(byteArrayOf(0xFF.toByte(), 0x01, (SHUTDOWN.size + 1).toByte(), 0x00) + SHUTDOWN)
        try { slipRead(1000) } catch (_: Exception) {}
    }

    fun rdbi(id: Int): ByteArray {
        val r = transfer(byteArrayOf(0x22, (id shr 8).toByte(), id.toByte()))
        if ((r[0].toInt() and 0xFF) == 0x7F) throw IOException("Počítač odmítl dotaz ${id.toString(16)}")
        if (r.size < 3 || (r[0].toInt() and 0xFF) != 0x62) throw IOException("Neočekávaná odpověď (RDBI)")
        return r.copyOfRange(3, r.size)
    }

    /** Stažení bloku paměti; s kompresí LRE + XOR do konce proudu. */
    fun download(addr: Long, size: Int, compressed: Boolean, onBytes: (Int) -> Unit = {}): ByteArray {
        val init = transfer(byteArrayOf(0x35, if (compressed) 0x10 else 0x00, 0x34,
            (addr shr 24).toByte(), (addr shr 16).toByte(), (addr shr 8).toByte(), addr.toByte(),
            (size shr 16).toByte(), (size shr 8).toByte(), size.toByte()))
        if (init.size < 2 || (init[0].toInt() and 0xFF) != 0x75) throw IOException("Neočekávaná odpověď (upload init: ${hex(init)})")
        val out = ByteArrayOutputStream()
        var block = 1; var n = 0; var done = false
        val lre = Lre(out)
        try { while (n < size && !done) {
            if (cancelled()) throw Cancelled()
            // ztracená odpověď: stejný blok vyžádat znovu (UDS dovoluje opakování se stejným číslem bloku), max. 2×
            var r: ByteArray? = null
            for (k in 0..2) {
                val t0 = System.currentTimeMillis()
                try { r = transfer(byteArrayOf(0x36, block.toByte())); break } catch (e: IOException) {
                    if (e is Cancelled || k == 2 || e.message?.contains("časový limit") != true) { log("Blok $block: ${e.message} po ${(System.currentTimeMillis() - t0) / 1000} s (staženo $n B)"); throw e }
                    log("Blok $block: bez odpovědi ${(System.currentTimeMillis() - t0) / 1000} s (staženo $n B) – žádám znovu (${k + 1}/2)")
                    purge()
                }
            }
            if (r!!.size < 2 || (r[0].toInt() and 0xFF) != 0x76 || (r[1].toInt() and 0xFF) != (block and 0xFF)) throw IOException("Neočekávaná odpověď (blok $block)")
            val data = r.copyOfRange(2, r.size)
            if (data.isEmpty()) break
            if (compressed) done = lre.feed(data) else out.write(data)
            n += data.size; onBytes(n)
            block = (block + 1) and 0xFF
        } } catch (e: IOException) {
            // přerušené stahování: ukončit upload, ať počítač nezůstane v rozběhnutém přenosu
            if (e !is Cancelled) try { transfer(byteArrayOf(0x37)) } catch (_: Exception) {}
            throw e
        }
        val q = transfer(byteArrayOf(0x37))
        if ((q[0].toInt() and 0xFF) != 0x77) throw IOException("Neočekávaná odpověď (upload exit)")
        val res = out.toByteArray()
        if (compressed) for (i in 32 until res.size) res[i] = (res[i].toInt() xor res[i - 32].toInt()).toByte()
        return res
    }

    /** LRE: 9bitové hodnoty – bit 0x100 = bajt, jinak počet nul, 0 = konec. */
    private class Lre(val out: ByteArrayOutputStream) {
        fun feed(d: ByteArray): Boolean {
            val nbits = d.size * 8
            if (nbits % 9 != 0) throw IOException("Chyba dekomprese (LRE)")
            var off = 0
            while (off + 9 <= nbits) {
                val b = off / 8; val bit = off % 8
                val hi = d[b].toInt() and 0xFF
                val lo = if (b + 1 < d.size) d[b + 1].toInt() and 0xFF else 0
                val v = (((hi shl 8) or lo) shr (16 - (bit + 9))) and 0x1FF
                when {
                    v and 0x100 != 0 -> out.write(v and 0xFF)
                    v == 0 -> return true
                    else -> repeat(v) { out.write(0) }
                }
                off += 9
            }
            return false
        }
    }

    /** Záznam seznamu ponorů: začátek (20–23) a konec (24–27) ponoru v paměti, otisk = začátek ponoru, raw = celých 32 B. */
    class Entry(val addr: Long, val fp: Long, val end: Long, val raw: ByteArray)

    /** Seznam ponorů: 0xA5C4 platný, 0x5A23 smazaný; otisk = čas začátku ponoru. */
    fun manifest(): List<Entry> {
        val list = ArrayList<Entry>()
        for (page in 0 until 40) {
            val m = download(MANIFEST_ADDR, MANIFEST_SIZE, false)
            var n = 0; var i = 0
            while (i + 32 <= m.size) {
                val h = ((m[i].toInt() and 0xFF) shl 8) or (m[i + 1].toInt() and 0xFF)
                if (h == 0x5A23) { n++; i += 32; continue }
                if (h != 0xA5C4) break
                n++
                fun be(o: Int) = ((m[i + o].toLong() and 0xFF) shl 24) or ((m[i + o + 1].toLong() and 0xFF) shl 16) or ((m[i + o + 2].toLong() and 0xFF) shl 8) or (m[i + o + 3].toLong() and 0xFF)
                list.add(Entry(be(20), be(4), be(24), m.copyOfRange(i, i + 32)))
                i += 32
            }
            if (n != m.size / 32) break
        }
        return list
    }
}
