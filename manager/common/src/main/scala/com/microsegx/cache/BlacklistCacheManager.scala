package com.microsegx.cache

import com.microsegx.model.Blacklist
import com.microsegx.model.UserBlacklist
import net.sf.ehcache.CacheManager
import com.microsegx.utils.Common.shortKey

object BlacklistCacheManager {
  given cacheKeyGenerator: ToStringCacheKeyGenerator.type = ToStringCacheKeyGenerator
  given cacheManager: CacheManager                        = CacheManager.getInstance()

  val cacheName = "blacklistCache"

  val cache: Cache[String, Blacklist] =
    Ehcache[String, Blacklist](cacheName)

  /**
   * Save blacklist for Graph.
   */
  def saveBlacklist(userBlacklist: UserBlacklist, tokenId: String): Unit =
    userBlacklist.blacklist.foreach(
      cache.put(userBlacklist.user + shortKey(tokenId) + "blacklist", _)
    )

  /**
   * Get blacklist of user for Graph
   * @param user
   *   the user
   * @param tokenId
   *   the token ID
   * @return
   *   [[com.microsegx.model.Blacklist]]
   */
  def getBlacklist(user: String, tokenId: String): Option[Blacklist] =
    cache.get(user + shortKey(tokenId) + "blacklist")
}
