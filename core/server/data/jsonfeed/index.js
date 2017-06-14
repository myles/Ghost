var crypto = require('crypto'),
    downsize = require('downsize'),
    config = require('../../config'),
    utils = require('../../utils'),
    errors = require('../../errors'),
    i18n = require('../../i18n'),
    filters = require('../../filters'),
    processUrls = require('../../utils/make-absolute-urls'),
    settingsCache = require('../../settings/cache'),

    // Really ugly temporary hack for location of things
    fetchData = require('../../controllers/frontend/fetch-data'),

    generate,
    generateFeed,
    generateTags,
    getJSONFeed,
    feedCache = {};

function isTag(req) {
    return req.originalUrl.indexOf(utils.url.urlJoin('/', config.get('routeKeywords').tag, '/')) !== -1;
}

function isAuthor(req) {
    return req.originalUrl.indexOf(utils.url.urlJoin('/', config.get('routeKeywords').author, '/')) !== -1;
}

function handleError(next) {
    return function handleError(err) {
        return next(err);
    };
}

function getData(channelOpts, slugParam) {
    channelOpts.data = channelOpts.data || {};

    return fetchData(channelOpts, slugParam).then(function (result) {
        var response = {},
            titleStart = '';

        if (result.data && result.data.tag) { titleStart = result.data.tag[0].name + ' - ' || ''; }
        if (result.data && result.data.author) { titleStart = result.data.author[0].name + ' - ' || ''; }

        response.title = titleStart + settingsCache.get('title');
        response.description = settingsCache.get('description');
        response.results = {
            posts: result.posts,
            meta: result.meta
        };

        return response;
    });
}

function getBaseUrl(req, slugParam) {
    var baseUrl = utils.url.getSubdir();

    if (isTag(req)) {
        baseUrl = utils.url.urlJoin(baseUrl, config.get('routeKeywords').tag, slugParam, 'json/');
    } else if (isAuthor(req)) {
        baseUrl = utils.url.urlJoin(baseUrl, config.get('routeKeywords').author, slugParam, 'json/');
    } else {
        baseUrl = utils.url.urlJoin(baseUrl, 'json/');
    }

    return baseUrl;
}

getJSONFeed = function getJSONFeed(path, data) {
    var dataHash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');

    if (!feedCache[path] || feedCache[path].hash !== dataHash) {
        // We need to regenerate
        feedCache[path] = {
            hash: dataHash,
            json: generateFeed(data)
        };
    }

    return feedCache[path].json;
};

generateTags = function generateTags(data) {
    if (data.tags) {
        return data.tags.reduce(function (tags, tag) {
            if (tag.visibility !== 'internal') {
                tags.push(tag.name);
            }
            return tags;
        }, []);
    }

    return [];
};

generateFeed = function generateFeed(data) {
    var feed = {
        version: 'https://jsonfeed.org/version/1',
        title: data.title,
        home_page_url: data.siteUrl,
        feed_url: data.feedUrl,
        description: data.description,
        favicon: utils.url.urlFor({relativeUrl: 'favicon.png'}, true),
        items: []
    };

    if (data.results.meta.pagination.next) {
        feed.next_url = data.nextFeedUrl;
    }

    data.results.posts.forEach(function forEach(post) {
        var itemUrl = utils.url.urlFor('post', {post: post, secure: data.secure}, true),
            htmlContent = processUrls(post.html, data.siteUrl, itemUrl),
            item = {
                id: post.id,
                url: itemUrl,
                title: post.title,
                content_html: post.meta_description || downsize(htmlContent.html(), {words: 50}),
                date_published: post.published_at,
                image: ''
            },
            imageUrl;

        if (post.feature_image) {
            imageUrl = utils.url.urlFor('image', {image: post.feature_image, secure: data.secure}, true);

            // Add a media content tag
            item.image = imageUrl;

            // Also add the image to the content
            htmlContent('p').first().before('<img src="' + imageUrl + '" />');
            htmlContent('img').attr('alt', post.title);
        }

        filters.doFilter('jsonfeed.item', item, post).then(function them(item) {
            feed.items.push(item);
        });
    });

    return filters.doFilter('jsonfeed.feed', feed).then(function then(feed) {
        return feed;
    });
};

generate = function generate(req, res, next) {
    // Initialize JSON
    var pageParam = req.params.page !== undefined ? req.parmas.page : 1,
        slugParam = req.params.slug,
        baseUrl = getBaseUrl(req, slugParam);

    // Ensure we at least have an empty object for postOptions
    req.channelConfig.postOptions = req.channelConfig.postOptions || {};
    // Set page on postOptions for the query made later
    req.channelConfig.postOptions.page = pageParam;

    req.channelConfig.slugParam = slugParam;

    return getData(req.channelConfig).then(function then(data) {
        var maxPage = data.results.meta.pagination.pages;

        // If page is greater than number of pages we have, redirect to last page
        if (pageParam > maxPage) {
            return next(new errors.NotFoundError({message: i18n.t('errors.errors.pageNotFound')}));
        }

        data.version = res.locals.safeVersion;
        data.siteUrl = utils.url.urlFor('home', {secure: req.secure}, true);
        data.feedUrl = utils.url.urlFor({relativeUrl: baseUrl, secure: req.secure}, true);
        data.nextFeedUrl = utils.url.urlFor({relativeUrl: baseUrl, secure: req.secure}, true) + data.results.meta.pagination.next + '/';
        data.secure = req.secure;

        return getJSONFeed(req.originalUrl, data).then(function then(jsonFeed) {
            res.set('Content-Type', 'application/json');
            res.send(JSON.stringify(jsonFeed));
        });
    }).catch(handleError(next));
};

module.exports = generate;
