import I18n from "I18n";
import { debounce } from "@ember/runloop";
import { createWidget } from "discourse/widgets/widget";
import transformPost from "discourse/lib/transform-post";
import { Placeholder } from "discourse/lib/posts-with-placeholders";
import { addWidgetCleanCallback } from "discourse/components/mount-widget";
import { isTesting } from "discourse-common/config/environment";
import { avatarFor } from "discourse/widgets/post";
import { h } from "virtual-dom";
import DiscourseURL from "discourse/lib/url";
import { iconNode } from "discourse-common/lib/icon-library";

let transformCallbacks = null;
export function postTransformCallbacks(transformed) {
  if (transformCallbacks === null) {
    return;
  }

  for (let i = 0; i < transformCallbacks.length; i++) {
    transformCallbacks[i].call(this, transformed);
  }
}
export function addPostTransformCallback(callback) {
  transformCallbacks = transformCallbacks || [];
  transformCallbacks.push(callback);
}

const CLOAKING_ENABLED = !isTesting();
const DAY = 1000 * 60 * 60 * 24;

const _dontCloak = {};
let _cloaked = {};
let _heights = {};

export function preventCloak(postId) {
  _dontCloak[postId] = true;
}

export function cloak(post, component) {
  if (!CLOAKING_ENABLED || _cloaked[post.id] || _dontCloak[post.id]) {
    return;
  }

  const $post = $(`#post_${post.post_number}`).parent();
  _cloaked[post.id] = true;
  _heights[post.id] = $post.outerHeight();

  component.dirtyKeys.keyDirty(`post-${post.id}`);
  debounce(component, "queueRerender", 1000);
}

export function uncloak(post, component) {
  if (!CLOAKING_ENABLED || !_cloaked[post.id]) {
    return;
  }
  _cloaked[post.id] = null;
  component.dirtyKeys.keyDirty(`post-${post.id}`);
  component.queueRerender();
}

addWidgetCleanCallback("post-stream", () => {
  _cloaked = {};
  _heights = {};
});

createWidget("post-filtered-replies", {
  buildKey: (attrs) => `post-filtered-replies-${attrs.id}`,

  buildClasses() {
    return ["filtered-replies-overlay"];
  },

  html(attrs) {
    const filters = attrs.streamFilters;

    if (filters.replies_to_post_number) {
      const sourcePost = attrs.posts.findBy(
        "post_number",
        filters.replies_to_post_number
      );

      return [
        h(
          "span.filtered-replies-viewing",
          I18n.t("post.filtered_replies.viewing", {
            reply_count: sourcePost.reply_count,
          })
        ),
        h(
          "span.filtered-avatar",
          avatarFor.call(this, "small", {
            template: sourcePost.avatar_template,
            username: sourcePost.username,
            url: sourcePost.usernameUrl,
          })
        ),
        this.attach("filter-jump-to-post", {
          username: sourcePost.username,
          postNumber: filters.replies_to_post_number,
        }),
        this.attach("filter-show-all", attrs),
      ];
    } else if (filters.filter && filters.filter === "summary") {
      return [
        h(
          "span.filtered-replies-viewing",
          I18n.t("post.filtered_replies.viewing_summary")
        ),
        this.attach("filter-show-all", attrs),
      ];
    } else if (filters.username_filters) {
      return [
        h(
          "span.filtered-replies-viewing",
          I18n.t("post.filtered_replies.viewing_posts_by", {
            post_count: attrs.posts.length,
          })
        ),
        h(
          "span.filtered-avatar",
          avatarFor.call(this, "small", {
            template: attrs.posts[0].avatar_template,
            username: attrs.posts[0].username,
            url: attrs.posts[0].usernameUrl,
          })
        ),
        this.attach("poster-name", attrs.posts[0]),
        this.attach("filter-show-all", attrs),
      ];
    }
  },
});

createWidget("filter-jump-to-post", {
  tagName: "a.filtered-jump-to-post",
  buildKey: (attrs) => `jump-to-post-${attrs.id}`,

  html(attrs) {
    return I18n.t("post.filtered_replies.post_number", {
      username: attrs.username,
      post_number: attrs.postNumber,
    });
  },

  click() {
    DiscourseURL.jumpToPost(this.attrs.postNumber);
  },
});

createWidget("filter-show-all", {
  tagName: "a.filtered-replies-show-all",
  buildKey: (attrs) => `filtered-show-all-${attrs.id}`,

  buildClasses() {
    return ["btn", "btn-primary"];
  },

  html() {
    return [iconNode("far-comments"), I18n.t("post.filtered_replies.show_all")];
  },

  click() {
    this.sendWidgetAction("cancelFilter");
  },
});

export default createWidget("post-stream", {
  tagName: "div.post-stream",

  html(attrs) {
    const posts = attrs.posts || [],
      postArray = posts.toArray(),
      result = [],
      before = attrs.gaps && attrs.gaps.before ? attrs.gaps.before : {},
      after = attrs.gaps && attrs.gaps.after ? attrs.gaps.after : {},
      mobileView = this.site.mobileView;

    let prevPost;
    let prevDate;

    for (let i = 0; i < postArray.length; i++) {
      const post = postArray[i];

      if (post instanceof Placeholder) {
        result.push(this.attach("post-placeholder"));
        continue;
      }

      const nextPost = i < postArray.length - 1 ? postArray[i + 1] : null;

      const transformed = transformPost(
        this.currentUser,
        this.site,
        post,
        prevPost,
        nextPost
      );
      transformed.canCreatePost = attrs.canCreatePost;
      transformed.mobileView = mobileView;

      if (transformed.canManage || transformed.canSplitMergeTopic) {
        transformed.multiSelect = attrs.multiSelect;

        if (attrs.multiSelect) {
          transformed.selected = attrs.selectedQuery(post);
        }
      }

      if (attrs.searchService) {
        transformed.highlightTerm = attrs.searchService.highlightTerm;
      }

      // Post gap - before
      const beforeGap = before[post.id];
      if (beforeGap) {
        result.push(
          this.attach(
            "post-gap",
            { pos: "before", postId: post.id, gap: beforeGap },
            { model: post }
          )
        );
      }

      // Handle time gaps
      const curTime = new Date(transformed.created_at).getTime();
      if (prevDate) {
        const daysSince = Math.floor((curTime - prevDate) / DAY);
        if (daysSince > this.siteSettings.show_time_gap_days) {
          result.push(this.attach("time-gap", { daysSince }));
        }
      }
      prevDate = curTime;

      transformed.height = _heights[post.id];
      transformed.cloaked = _cloaked[post.id];

      postTransformCallbacks(transformed);

      if (transformed.isSmallAction) {
        result.push(
          this.attach("post-small-action", transformed, { model: post })
        );
      } else {
        transformed.showReadIndicator = attrs.showReadIndicator;
        result.push(this.attach("post", transformed, { model: post }));
      }

      // Post gap - after
      const afterGap = after[post.id];
      if (afterGap) {
        result.push(
          this.attach(
            "post-gap",
            { pos: "after", postId: post.id, gap: afterGap },
            { model: post }
          )
        );
      }

      prevPost = post;
    }

    if (Object.keys(attrs.streamFilters).length > 0) {
      result.push(
        this.attach("post-filtered-replies", {
          posts: postArray,
          streamFilters: attrs.streamFilters,
        })
      );
    }

    return result;
  },
});
