var utils = require('../../utils');

function getRssUrl(data, absolute) {
    return utils.url.urlFor('json', {secure: data.secure}, absolute);
}

module.exports = getRssUrl;
