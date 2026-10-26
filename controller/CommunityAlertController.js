import CommunityAlert from '../model/CommunityAlertSchema.js';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requireMatchingIdentity } from '../utils/actor.js';
import mongoose from 'mongoose';
import { objectId, text, jsonObject } from '../utils/validation.js';
import { pagination, pageResult } from '../utils/pagination.js';

const getAllPosts = async (req, res, next) => {
    try {
        const { limit, filter } = pagination(req.query);
        const rows = await CommunityAlert.find(filter)
            .select('-comments')
            .sort({ _id: -1 })
            .limit(limit + 1)
            .lean();
        const page = pageResult(rows, limit);

        const formattedPosts = page.items.map((post) => ({
            id: post._id.toString(),
            userId: post.userId,
            username: post.username,
            content: post.content,
            imageUrl: '', // Legacy image references are retained in storage pending an asset/privacy audit.
            likes: post.likes,
            comments: [], // Loaded separately through the bounded comments endpoint.
            createdAt: post.createdAt,
        }));

        successResponse(res, formattedPosts, 200, {
            pagination: page.pagination,
        });
    } catch (error) {
        next(error);
    }
};

const createPost = async (req, res, next) => {
    try {
        const body = jsonObject(req.body);
        const content = text(body.content, 'content', 4000);
        const imageUrl =
            body.imageUrl === undefined
                ? ''
                : text(body.imageUrl, 'image URL', 2048, true);
        const userId = requireMatchingIdentity(
            req,
            req.body.userId,
            req.body.username,
        );
        const username = req.user.username;

        if (imageUrl) {
            throw new AppError(
                'Image uploads are unavailable. Create a text-only post.',
                400,
                'IMAGE_UPLOAD_UNAVAILABLE',
            );
        }

        if (typeof content !== 'string' || !content.trim()) {
            throw new AppError('Content is required', 400);
        }

        const newPost = new CommunityAlert({
            userId,
            username,
            content,
            imageUrl,
        });

        const savedPost = await newPost.save();

        const formattedPost = {
            id: savedPost._id.toString(),
            userId: savedPost.userId,
            username: savedPost.username,
            content: savedPost.content,
            imageUrl: savedPost.imageUrl,
            likes: savedPost.likes,
            comments: [],
            createdAt: savedPost.createdAt,
        };

        successResponse(res, formattedPost, 201);
    } catch (error) {
        next(error);
    }
};

const likePost = async (req, res, next) => {
    try {
        const post = await CommunityAlert.findById(
            objectId(req.params.postId, 'post ID'),
        );
        if (!post) {
            throw new AppError('Post not found', 404);
        }

        post.likes += 1;
        await post.save();

        successResponse(res, {
            id: post._id.toString(),
            likes: post.likes,
        });
    } catch (error) {
        next(error);
    }
};

const commentOnPost = async (req, res, next) => {
    try {
        const content = text(jsonObject(req.body).content, 'content', 2000);
        const userId = requireMatchingIdentity(
            req,
            req.body.userId,
            req.body.username,
        );
        const username = req.user.username;

        if (typeof content !== 'string' || !content.trim()) {
            throw new AppError('Content is required', 400);
        }

        const post = await CommunityAlert.findById(
            objectId(req.params.postId, 'post ID'),
        );
        if (!post) {
            throw new AppError('Post not found', 404);
        }

        post.comments.push({ userId, username, content });
        await post.save();

        const newComment = post.comments[post.comments.length - 1];

        successResponse(
            res,
            {
                id: newComment._id?.toString() || '',
                userId: newComment.userId,
                username: newComment.username,
                content: newComment.content,
                createdAt: newComment.createdAt,
            },
            201,
        );
    } catch (error) {
        next(error);
    }
};

const getComments = async (req, res, next) => {
    try {
        const id = objectId(req.params.postId, 'post ID');
        const { limit, filter } = pagination(req.query);
        const before = filter._id?.$lt;
        const rows = await CommunityAlert.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(id) } },
            {
                $facet: {
                    exists: [{ $limit: 1 }, { $project: { _id: 1 } }],
                    items: [
                        { $unwind: '$comments' },
                        ...(before
                            ? [
                                  {
                                      $match: {
                                          'comments._id': {
                                              $lt: new mongoose.Types.ObjectId(
                                                  before,
                                              ),
                                          },
                                      },
                                  },
                              ]
                            : []),
                        { $sort: { 'comments._id': -1 } },
                        { $limit: limit + 1 },
                        { $replaceRoot: { newRoot: '$comments' } },
                    ],
                },
            },
        ]);
        if (!rows[0]?.exists.length) throw new AppError('Post not found', 404);
        const page = pageResult(rows[0].items, limit);
        successResponse(
            res,
            page.items.map((comment) => ({
                id: String(comment._id),
                userId: comment.userId,
                username: comment.username,
                content: comment.content,
                createdAt: comment.createdAt,
            })),
            200,
            { pagination: page.pagination },
        );
    } catch (error) {
        next(error);
    }
};

export default {
    getAllPosts,
    createPost,
    likePost,
    commentOnPost,
    getComments,
};
