package com.microsegx.cache

import com.microsegx.model.Position
import com.microsegx.model.UserGraphLayout
import net.sf.ehcache.CacheManager
import com.microsegx.utils.Common.shortKey

/**
 * Created by bxu on 2/2/18. Manager graph layout for node and group view.
 * [[com.microsegx.model.Position]] saved in cache which is disk backed, check the ehcache.xml for disk
 * store.
 */
object GraphCacheManager {
  given cacheKeyGenerator: ToStringCacheKeyGenerator.type = ToStringCacheKeyGenerator
  given cacheManager: CacheManager                        = CacheManager.getInstance()

  val cacheName = "posCache"

  val cache: Cache[String, Map[String, Position]] =
    Ehcache[String, Map[String, Position]](cacheName)

  /**
   * Save graph layout for each user
   * @param layout
   *   the [[com.microsegx.model.UserGraphLayout]]
   */
  def saveNodeLayout(layout: UserGraphLayout, tokenId: String): Unit =
    if (layout.nodePositions.nonEmpty)
      cache.put(layout.user + shortKey(tokenId) + "node", layout.nodePositions.get)

  /**
   * Get node graph layout for user
   * @param user
   *   the user
   * @return
   *   [[com.microsegx.model.Position]]
   */
  def getNodeLayout(user: String, tokenId: String): Option[Map[String, Position]] =
    cache.get(user + shortKey(tokenId) + "node")

  /**
   * Get group layout for user
   * @param user
   *   the user
   * @return
   *   [[com.microsegx.model.Position]]
   */
  def getGroupLayout(user: String): Option[Map[String, Position]] = cache.get(user + "group")
}
